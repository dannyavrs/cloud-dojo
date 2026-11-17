import { Check, CircleDashed, Copy as CopyI, Loader, RotateCcw, SquareTerminal, X } from 'lucide-react'

/** Status glyphs. Always paired with a word where space allows; classes kept for the capture script. */
export const Tick = () => <Check className="tick pass" size={16} strokeWidth={2.6} aria-label="passed" />
export const Cross = () => <X className="tick fail" size={16} strokeWidth={2.6} aria-label="failed" />
export const Dot = () => <CircleDashed className="tick todo" size={16} strokeWidth={2} aria-label="not checked" />
export const Spin = () => <Loader className="tick spin" size={16} aria-label="in progress" />
export const Copy = () => <CopyI size={13} strokeWidth={2} />
export const Send = () => <SquareTerminal size={13} strokeWidth={2} />
export const Reset = () => <RotateCcw size={13} strokeWidth={2} />
