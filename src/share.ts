// "Share as a front page": draws the explainer as a newspaper front page on a canvas (1080 x 1350, the
// portrait size Instagram and WhatsApp show best), all in the browser. Only the explainer goes on the
// picture, never the original text.

export interface FrontPage {
  headline: string;
  first: { title: string; items: string[] };
  second: { title: string; items: string[] };
  third?: { title: string; items: string[] };
  ranOn: "on_device" | "in_cloud";
  seconds: string;
  date: string;
}

const W = 1080;
const H = 1350;
const M = 72; // side margin
const C = { paper: "#f3efe6", ink: "#111111", ink2: "#3b3833", muted: "#736d65", line: "#cfc8ba", rust: "#a8431a", slate: "#3e4a5b" };
const F = {
  mast: '"UnifrakturMaguntia", serif',
  serif: '"Literata Variable", Georgia, serif',
  sans: '"Libre Franklin Variable", system-ui, sans-serif',
};

// Breaks text into lines that fit the width; the last allowed line ends with "…" if text is left over.
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width <= width || !line) {
      line = test;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines) {
      let last = lines[maxLines - 1];
      while (ctx.measureText(`${last}…`).width > width && last.includes(" ")) last = last.slice(0, last.lastIndexOf(" "));
      lines[maxLines - 1] = `${last.replace(/[,.;:]$/, "")}…`;
      return lines;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: "left" | "center" | "right" = "left"): void {
  const chars = [...text];
  const width = chars.reduce((w, ch) => w + ctx.measureText(ch).width, 0) + spacing * (chars.length - 1);
  let at = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  ctx.textAlign = "left";
  for (const ch of chars) {
    ctx.fillText(ch, at, y);
    at += ctx.measureText(ch).width + spacing;
  }
}

function rule(ctx: CanvasRenderingContext2D, y: number, h: number, color = C.ink): void {
  ctx.fillStyle = color;
  ctx.fillRect(M, y, W - 2 * M, h);
}

export async function drawFrontPage(p: FrontPage): Promise<Blob> {
  await Promise.all([
    document.fonts.load(`120px ${F.mast}`),
    document.fonts.load(`700 56px ${F.serif}`),
    document.fonts.load(`italic 400 28px ${F.serif}`),
    document.fonts.load(`700 20px ${F.sans}`),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  // Top bar
  ctx.fillStyle = C.ink2;
  ctx.font = `600 19px ${F.sans}`;
  spaced(ctx, p.date.toUpperCase(), M, 74, 2.4);
  spaced(ctx, "PRIVATE · NEUTRAL · PLAIN", W - M, 74, 2.4, "right");
  rule(ctx, 94, 2);

  // Masthead
  ctx.fillStyle = C.ink;
  ctx.font = `132px ${F.mast}`;
  ctx.textAlign = "center";
  ctx.fillText("Plain Politics", W / 2, 236);
  ctx.fillStyle = C.ink2;
  ctx.font = `italic 400 30px ${F.serif}`;
  ctx.fillText("Political text, explained in plain words.", W / 2, 292);
  rule(ctx, 322, 6);
  rule(ctx, 334, 2);

  // Headline
  let y = 398;
  ctx.fillStyle = C.muted;
  ctx.font = `700 19px ${F.sans}`;
  spaced(ctx, "IN ONE SENTENCE", M, y, 3);
  ctx.fillStyle = C.ink;
  ctx.font = `700 54px ${F.serif}`;
  y += 64;
  for (const line of wrap(ctx, p.headline, W - 2 * M, 5)) {
    ctx.textAlign = "left";
    ctx.fillText(line, M, y);
    y += 64;
  }

  // Two sections, one under the other
  const sections = [
    { ...p.first, color: C.ink },
    { ...p.second, color: C.rust },
    ...(p.third ? [{ ...p.third, color: C.ink }] : []),
  ];
  y += 6;
  for (const [i, s] of sections.entries()) {
    // A section only starts if its title and at least one line fit above the foot.
    if (!s.items.length || y + 110 > H - 170) continue;
    rule(ctx, y, i === 1 ? 4 : 2, i === 1 ? C.ink : C.line);
    y += 44;
    ctx.fillStyle = s.color;
    ctx.font = `800 20px ${F.sans}`;
    spaced(ctx, s.title.toUpperCase(), M, y, 3);
    y += 14;
    ctx.font = `400 29px ${F.serif}`;
    for (const item of s.items.slice(0, 3)) {
      const lines = wrap(ctx, item, W - 2 * M - 34, 2);
      if (y + 42 + 40 * (lines.length - 1) > H - 175) break;
      y += 42;
      ctx.fillStyle = s.color;
      ctx.fillRect(M, y - 19, 10, 10);
      ctx.fillStyle = C.ink;
      for (const [j, line] of lines.entries()) {
        ctx.textAlign = "left";
        ctx.fillText(line, M + 34, y + j * 40);
      }
      y += 40 * (lines.length - 1);
    }
    y += 34;
  }

  // Foot: the stamp says where it ran, and the address
  rule(ctx, H - 150, 2);
  const device = p.ranOn === "on_device";
  const stamp = device ? "RAN ON YOUR DEVICE" : "RAN IN THE CLOUD";
  const small = device ? `${p.seconds} S · NOTHING SENT` : `${p.seconds} S · GOOGLE GEMINI`;
  const color = device ? C.ink : C.slate;
  ctx.save();
  ctx.translate(M + 6, H - 72);
  ctx.rotate((-1.5 * Math.PI) / 180);
  ctx.font = `800 26px ${F.sans}`;
  const w1 = ctx.measureText(stamp).width + 2 * stamp.length;
  ctx.font = `600 17px ${F.sans}`;
  const w2 = ctx.measureText(small).width + 1.6 * small.length;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(0, -38, w1 + w2 + 52, 58);
  ctx.fillStyle = color;
  ctx.font = `800 26px ${F.sans}`;
  spaced(ctx, stamp, 18, 0, 2);
  ctx.font = `600 17px ${F.sans}`;
  spaced(ctx, small, 34 + w1, -1, 1.6);
  ctx.restore();
  ctx.fillStyle = C.muted;
  ctx.font = `700 17px ${F.sans}`;
  spaced(ctx, "PLAIN-POLITICS-APP.WEB.APP", W - M - 12, H - 76, 1.6, "right");
  ctx.fillStyle = C.rust;
  ctx.fillRect(W - M - 8, H - 82, 8, 8);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the picture."))), "image/png"));
}
