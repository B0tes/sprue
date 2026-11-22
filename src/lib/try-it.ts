// The Try this card's data and its reasons. The site's client component imports this file, so it imports nothing that
// needs Node (example.ts reads the product's files, and the browser bundle can't hold that).
import { usd } from "../../skills/sprue/viewer/explorer.js";

export type TryIt = {
  line: string;
  lineId: string;
  from: string;
  to: string;
  partDelta: number;
  totalDelta: number;
  newTotal: number;
  /** The quoted shop's shipping comes off the order: it leaves it, or only makes these lines (boards, whose shipping is
   * in their price) then. */
  leaves?: number;
  keeps?: string[];
  /** The new shop joins the order, and the shipping it adds. */
  joins?: number;
  /** Other lines the requote moves to the new shop with it. */
  moves?: string[];
};

/** The Try this card's reasons, in order: the lines the requote buys at the picked shop too, the quoted shop's
 * shipping coming off (it leaves the order, or then only makes boards, whose shipping is in their price), and the
 * picked shop's shipping joining; a shipping of $0 that comes off or joins is no reason. */
export function tryWhy(t: TryIt): string[] {
  const why: string[] = [];
  if (t.moves?.length) why.push(`the requote buys the ${t.moves.join(" and the ")} there too`);
  if (t.leaves)
    why.push(t.keeps ? `${t.from}'s ${usd(t.leaves)} shipping comes off, as ${t.from} then only makes the ${t.keeps.join(" and the ")}, whose price includes its shipping`
      : `${t.from} leaves the order, which saves its ${usd(t.leaves)} shipping`);
  if (t.joins) why.push(`${t.to} adds ${usd(t.joins)} of shipping`);
  return why;
}
