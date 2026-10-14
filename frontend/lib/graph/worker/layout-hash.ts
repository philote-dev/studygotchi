/**
 * Fingerprint of everything the force layout's settled positions depend on:
 * node order, ids, radii and label lengths (collision radius), link order,
 * ids and endpoints. The seed positions come from the ids, d3's tick order
 * from the node order, so unlike the parity `graphHash` this one is NOT
 * order-free. Pure, shared by the main thread and the Worker.
 */

export interface LayoutNodeInput {
  id: string;
  radius: number;
  labelLength: number;
}

export interface LayoutLinkInput {
  id: string;
  source: string;
  target: string;
}

export interface LayoutInputs {
  nodes: LayoutNodeInput[];
  links: LayoutLinkInput[];
}

export function layoutHash(inputs: LayoutInputs): string {
  let value = 2166136261;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      value ^= text.charCodeAt(i);
      value = Math.imul(value, 16777619);
    }
    value ^= 0x1f;
    value = Math.imul(value, 16777619);
  };
  feed(`n${inputs.nodes.length}`);
  for (const n of inputs.nodes) feed(`${n.id}|${n.radius}|${n.labelLength}`);
  feed(`l${inputs.links.length}`);
  for (const l of inputs.links) feed(`${l.id}|${l.source}|${l.target}`);
  return (value >>> 0).toString(16).padStart(8, "0") + inputs.nodes.length.toString(16);
}
