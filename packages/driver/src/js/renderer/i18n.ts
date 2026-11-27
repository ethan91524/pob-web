// Display-only translation: PoB keeps working in English; strings are swapped right before
// they are measured and drawn, so layout widths match what is shown.
type Dictionary = {
  exact: Record<string, string>;
  pattern: Record<string, [string, number[]]>;
};

const COLOR_SPLIT = /(\^[0-9]|\^[xX][0-9a-fA-F]{6})/;
const NUMBER_WITH_SIGN = /[-+]?\d+(?:\.\d+)?%?/g;
const NUMBER_ONLY = /\d+(?:\.\d+)?/g;
const LETTER = /[A-Za-z]/;
const PLACEHOLDER = /\{(\d+)\}/g;

class Translator {
  private dict: Dictionary | undefined;
  private cache = new Map<string, string>();

  async load(url: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) return;
      this.dict = await response.json();
    } catch {
      this.dict = undefined;
    }
  }

  t(text: string): string {
    if (!this.dict || !text || !LETTER.test(text)) return text;
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;
    const result = this.whole(text) ?? text.split("\n").map((line) => this.line(line)).join("\n");
    if (this.cache.size > 50000) this.cache.clear();
    this.cache.set(text, result);
    return result;
  }

  private whole(text: string): string | undefined {
    if (COLOR_SPLIT.test(text)) return undefined;
    return this.dict!.exact[text];
  }

  private line(line: string): string {
    return line.split(COLOR_SPLIT).map((part, i) => (i % 2 === 1 ? part : this.segment(part))).join("");
  }

  private segment(part: string): string {
    if (!LETTER.test(part)) return part;
    const match = part.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
    const [, lead, core, trail] = match;
    const translated = this.lookup(core);
    return translated === undefined ? part : lead + translated + trail;
  }

  private lookup(core: string): string | undefined {
    const dict = this.dict!;
    const hit = dict.exact[core] ?? this.pattern(core);
    if (hit !== undefined) return hit;
    if (core.endsWith(":")) {
      const base = core.slice(0, -1);
      const baseHit = dict.exact[base] ?? this.pattern(base);
      if (baseHit !== undefined) return `${baseHit}:`;
    }
    return undefined;
  }

  private pattern(core: string): string | undefined {
    for (const re of [NUMBER_WITH_SIGN, NUMBER_ONLY]) {
      const values: string[] = [];
      const key = core.replace(re, (m) => {
        values.push(m);
        return "#";
      });
      if (values.length === 0) return undefined;
      const hit = this.dict!.pattern[key];
      if (!hit) continue;
      const [template, order] = hit;
      return template.replace(PLACEHOLDER, (m, index) => {
        const position = order.indexOf(Number(index));
        return position >= 0 && position < values.length ? values[position] : m;
      });
    }
    return undefined;
  }
}

export const translator = new Translator();
