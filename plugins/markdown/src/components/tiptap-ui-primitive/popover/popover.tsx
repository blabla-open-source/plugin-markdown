import { Popover as Primitive } from "@base-ui/react/popover";
import { cn } from "@/lib/tiptap-utils";
import "./popover.scss";
export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export function PopoverContent({className,align="center",sideOffset=4,anchor,...props}: Omit<Primitive.Popup.Props,"className"> & {className?:string} & {align?:Primitive.Positioner.Props["align"];sideOffset?:number;anchor?:Primitive.Positioner.Props["anchor"]}) {
  return <Primitive.Portal><Primitive.Positioner anchor={anchor} align={align} sideOffset={sideOffset} collisionPadding={8} className="markdown-panel-positioner"><Primitive.Popup className={cn("tiptap-popover",className)} {...props}/></Primitive.Positioner></Primitive.Portal>;
}
