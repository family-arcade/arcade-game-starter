import { IntlMessageFormat } from 'intl-messageformat';
import messages from './messages/en.json';

// Every word a player reads lives in messages/en.json, one flat object with dotted keys
// (game.<screen>.<name>), so it can be edited click-to-edit in Dialecto under `npm run dev:dialecto`.
// `t(key, values)` formats the message with ICU MessageFormat: `{`, `}` and a `'` next to them are
// syntax, so escape them ICU-style in en.json (`'{'`). Never change or measure what t() returns (no
// toUpperCase, split, slice, length, includes, comparisons or measureText): in dev the Dialecto plugin
// wraps each value in invisible marker characters. Use CSS text-transform, or do it on the data.
const catalog: Record<string, string> = messages;

// A parsed message per key, so a message asked for often is parsed once.
const parsed = new Map<string, IntlMessageFormat>();

export function t(key: string, values?: Record<string, unknown>): string {
  const message = catalog[key];
  if (message === undefined) {
    if (import.meta.env.DEV) throw new Error(`Missing message key: ${key}`);
    return key;
  }
  let format = parsed.get(key);
  if (!format) {
    format = new IntlMessageFormat(message, 'en');
    parsed.set(key, format);
  }
  return format.format(values as never) as string;
}
