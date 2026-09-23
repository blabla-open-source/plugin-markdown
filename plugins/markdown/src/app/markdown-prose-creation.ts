import {
	type Command,
	type CommandProps,
	commands as coreCommands,
	Extension,
	getExtensionField,
	getNodeType,
	InputRule,
	type JSONContent,
	type Node,
} from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { moveMixedListItems } from "./markdown-mixed-list-movement";
import {
	defaultProseCreation,
	generatedProseStyle,
	type ProseCreationPreferences,
	type ProseStyle,
	parsedProseStyle,
	renderStyledHeading,
} from "./markdown-prose-style";

/** Keep official schema/commands/input rules; syntax belongs to each source block. */
export function withProseCreation<T>(
	extension: Node<T>,
	getPreferences: () => ProseCreationPreferences = () => defaultProseCreation,
) {
	const name = extension.name;
	const parse = getExtensionField(extension, "parseMarkdown");
	const render = getExtensionField(extension, "renderMarkdown");
	return extension.extend({
		addAttributes() {
			return {
				...this.parent?.(),
				proseStyle: { default: null, rendered: false },
			};
		},
		parseMarkdown(token, helpers) {
			const result = parse?.call(this, token, helpers);
			const style = parsedProseStyle(name, token);
			const apply = (node: JSONContent) =>
				node.type === name
					? { ...node, attrs: { ...node.attrs, proseStyle: style } }
					: node;
			return Array.isArray(result)
				? result.map(apply)
				: result
					? apply(result)
					: [];
		},
		renderMarkdown(node, helpers, context) {
			if (name === "heading")
				return renderStyledHeading(
					node,
					helpers.renderChildren(node.content ?? []),
					context.parentType === "listItem" ||
						context.parentType === "taskItem",
				);
			const output = render?.call(this, node, helpers, context) ?? "";
			if (name !== "blockquote" || node.attrs?.alert || node.attrs?.alertSource)
				return output;
			const style = node.attrs?.proseStyle as ProseStyle | null;
			return output.replace(/^> /gm, `>${" ".repeat(style?.gap ?? 1)}`);
		},
		addCommands() {
			const commands = this.parent?.() ?? {};
			const styled =
				(command?: Command): Command =>
				(props: CommandProps) => {
					if (!command) return false;
					if (props.dispatch) closeHistory(props.tr);
					const result = command(props);
					if (result && props.dispatch)
						props
							.chain()
							.updateAttributes(name, {
								proseStyle: generatedProseStyle(name, getPreferences()),
							})
							.run();
					return result;
				};
			if (name === "heading")
				return {
					...commands,
					setHeading: (attrs) => styled(commands.setHeading?.(attrs)),
					toggleHeading: (attrs) => styled(commands.toggleHeading?.(attrs)),
				};
			if (name === "blockquote")
				return {
					...commands,
					toggleBlockquote: () => styled(commands.toggleBlockquote?.()),
				};
			const command =
				name === "orderedList"
					? "toggleOrderedList"
					: name === "taskList"
						? "toggleTaskList"
						: "toggleBulletList";
			return { ...commands, [command]: () => styled((props) => {
        let touchesList = false;
        const { from, to, $from } = props.state.selection;
        const isList = (type: string) => ["bulletList", "orderedList", "taskList"].includes(type);
        for (let depth = $from.depth; depth > 0; depth--)
          if (isList($from.node(depth).type.name)) touchesList = true;
        props.state.doc.nodesBetween(from, to, node => {
          if (isList(node.type.name)) touchesList = true;
        });
        // New list creation retains its own start and creation preferences.
        return touchesList ? (commands[command]?.()(props) ?? false) : coreCommands.wrapInList(name)(props);
      }) };
		},
		addInputRules() {
			return (this.parent?.() ?? []).map(
				(rule) =>
					new InputRule({
						...rule,
						handler: (props) => {
							const result = rule.handler(props);
							if (result === null) return null;
							const tr = props.state.tr;
							const { $from } = tr.selection;
							for (let depth = $from.depth; depth > 0; depth--) {
								const node = $from.node(depth);
								if (node.type.name === name && !node.attrs.proseStyle) {
									tr.setNodeMarkup($from.before(depth), undefined, {
										...node.attrs,
										proseStyle: parsedProseStyle(name, {
											type: name,
											raw: props.match[0],
										}),
									});
									break;
								}
							}
							return result;
						},
					}),
			);
		},
	});
}

/** Official sinking creates the inner list with default attrs. Carry its source style. */
function ownsSelectedListItem(type: Parameters<typeof coreCommands.liftListItem>[0], props: CommandProps) {
	const { $from } = props.state.selection;
	for (let depth = $from.depth; depth > 0; depth--) {
		const node = $from.node(depth);
		if (["listItem", "taskItem"].includes(node.type.name))
			return node.type === getNodeType(type, props.state.schema);
	}
	return false;
}

export const ProseListIndentation = Extension.create({
	name: "proseListIndentation",
	addCommands() {
		return {
			liftListItem: (type) => (props) => {
				if (!ownsSelectedListItem(type, props)) return false;
				if (props.dispatch) closeHistory(props.tr);
				return moveMixedListItems("lift", type, props) || coreCommands.liftListItem(type)(props);
			},
			sinkListItem: (type) => (props) => {
				if (!ownsSelectedListItem(type, props)) return false;
				if (props.dispatch) closeHistory(props.tr);
				const { $from } = props.state.selection;
				let style: ProseStyle | null = null;
				for (let depth = $from.depth; depth > 0; depth--) {
					const node = $from.node(depth);
					if (
						["bulletList", "orderedList", "taskList"].includes(node.type.name)
					) {
						style = node.attrs.proseStyle;
						break;
					}
				}
				const result = moveMixedListItems("sink", type, props) || coreCommands.sinkListItem(type)(props);
				if (!result || !props.dispatch || !style) return result;
				const next = props.tr.selection.$from;
				for (let depth = next.depth; depth > 0; depth--) {
					const node = next.node(depth);
					if (
						["bulletList", "orderedList", "taskList"].includes(node.type.name)
					) {
						if (!node.attrs.proseStyle)
							props.tr.setNodeMarkup(next.before(depth), undefined, {
								...node.attrs,
								proseStyle: style,
							});
						break;
					}
				}
				return result;
			},
		};
	},
});
