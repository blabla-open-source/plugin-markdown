import { attributeSelection } from "./markdown-attribute-selection";

export const {
	Selection: FootnoteLabelSelection,
	observe: observeFootnoteSelection,
	plugin: footnoteLabelSelectionPlugin,
} = attributeSelection("footnoteDefinition", "label", "footnoteLabel");
