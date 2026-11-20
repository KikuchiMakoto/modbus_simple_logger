import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui class combiner: clsx for conditionals, tailwind-merge so that a
 * `className` passed by the caller replaces the component's own utility of the
 * same kind (`p-1` beats the Card's `p-2`) instead of racing it on source order.
 * That is what lets the ui/ components carry their defaults as plain utilities —
 * the old unlayered `.card` / `.button-*` rules could only be overridden by
 * another unlayered rule placed after them.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
