// The farm, drawn once, used as the backdrop of every screen.
//
// Orthographic (isometric) projection in plain SVG: no canvas, no 3D, nothing to
// load. Ported from the design canvas generator, so the mockups and the app draw
// the same world.
//
// What the player sees is decided entirely by tier and equipment. Nothing here
// knows about calls, coins or rounds.

import { useMemo, type ReactElement } from "react";
import type { EquipmentId } from "farm-engine";

const P = {
  grassA: "#b9c78a", grassB: "#b1c081", grassLine: "#a5b476",
  soilTop: "#8f6d45", soilL: "#6f5334", soilR: "#5a4127", furrow: "#7a5b3a",
  stalk: "#7a9c3a", stalkDark: "#6a8a30", head: "#e2b13c", headDark: "#c9962a", sprout: "#8fae4a",
  water: "#7fb0c9", waterLight: "#a9cddd", waterEdge: "#6a98b0",
  path: "#cdb98f", pathEdge: "#b9a478",
  fence: "#6f5334",
  treeTrunk: "#6f5334", treeA: "#6d8f32", treeB: "#8fae4a", treeShadow: "#9fb070",
  shedWall: "#c9b48a", shedWallDark: "#a98a5c", shedRoof: "#b8552f", shedRoofDark: "#93401f",
  harvBody: "#b8552f", harvDark: "#93401f", harvWheel: "#33291f", harvGlass: "#dfe4ee",
  ghost: "#5a4b3a",
} as const;

const W = 1440;
const H = 900;
const COLS = 8;
const ROWS = 5;
const TW = 52;
const TH = 26;
const LIFT = 12;

const TREES: [number, number, number][] = [
  [-4, -3, 1.2], [2, -4, 1.1], [6, -5, 1], [11, -3, 1.2], [13, 1, 1],
  [-7, 3, 1.1], [-6, 7, 1], [3, 9, 1.2], [9, 8, 1], [14, 6, 1.1],
];
const POND: [number, number][] = [[11, 4], [12, 4], [11, 5], [12, 5], [13, 5], [12, 6]];
const PATH: [number, number][] = [[8, 5], [9, 5], [10, 5], [10, 6], [11, 7], [12, 7], [13, 8], [14, 8], [15, 9], [16, 9]];

/** Where the field sits on the frame, per screen. Panels claim the rest. */
export type ScenePreset = "stage" | "farm" | "title";

const ORIGINS: Record<ScenePreset, { ox: number; oy: number }> = {
  stage: { ox: 642, oy: 300 },
  farm: { ox: 880, oy: 280 },
  title: { ox: 960, oy: 300 },
};

export interface FarmSceneProps {
  tier: number;
  equipment: EquipmentId[];
  preset?: ScenePreset;
  className?: string;
}

export function FarmScene({ tier, equipment, preset = "stage", className }: FarmSceneProps) {
  const { ox, oy } = ORIGINS[preset];
  const hasShed = equipment.includes("shed");
  const hasHarvester = equipment.includes("harvester");
  const hasIrrigation = equipment.includes("irrigation");
  // Trees on the left would sit behind the title screen's headline.
  const trees = preset === "title" ? TREES.filter(([i]) => i >= 2) : TREES;

  const elements = useMemo(
    () => draw({ ox, oy, tier, hasShed, hasHarvester, hasIrrigation, trees }),
    [ox, oy, tier, hasShed, hasHarvester, hasIrrigation, trees],
  );

  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`Your wheat field at tier ${tier} of 5`}
    >
      {elements}
    </svg>
  );
}

interface DrawArgs {
  ox: number;
  oy: number;
  tier: number;
  hasShed: boolean;
  hasHarvester: boolean;
  hasIrrigation: boolean;
  trees: [number, number, number][];
}

function draw({ ox, oy, tier, hasShed, hasHarvester, hasIrrigation, trees }: DrawArgs): ReactElement[] {
  const c = (i: number, j: number, dy = 0): [number, number] => [ox + (i - j) * TW, oy + (i + j) * TH + dy];
  const pts = (arr: [number, number][]) => arr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const out: ReactElement[] = [];
  let n = 0;
  const key = () => `e${n++}`;

  const poly = (arr: [number, number][], fill: string, extra: Record<string, unknown> = {}) =>
    out.push(<polygon key={key()} points={pts(arr)} fill={fill} {...extra} />);
  const tile = (i: number, j: number, fill: string, dy = 0, extra: Record<string, unknown> = {}) =>
    poly([c(i, j, dy), c(i + 1, j, dy), c(i + 1, j + 1, dy), c(i, j + 1, dy)], fill, extra);
  const line = (a: [number, number], b: [number, number], stroke: string, sw: number) =>
    out.push(<line key={key()} x1={a[0].toFixed(1)} y1={a[1].toFixed(1)} x2={b[0].toFixed(1)} y2={b[1].toFixed(1)} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />);

  // Ground: a checkerboard big enough to reach every corner of the frame.
  const G = Math.ceil(Math.max(W, H) / TW) + 2;
  for (let s = -2 * G; s <= COLS + ROWS + 2 * G; s++) {
    for (let i = -G; i <= COLS + G; i++) {
      const j = s - i;
      if (j < -G || j > ROWS + G) continue;
      const [x, y] = c(i, j);
      if (x < -TW || x > W + TW || y < -TH * 2 || y > H + TH) continue;
      tile(i, j, (i + j) % 2 === 0 ? P.grassA : P.grassB, 0, { stroke: P.grassLine, strokeWidth: 0.6 });
    }
  }

  // Flat decor sits on the ground, under everything with height.
  for (const [i, j] of POND) tile(i, j, P.water, 0, { stroke: P.waterEdge, strokeWidth: 0.8 });
  for (const [i, j] of POND) {
    const [x, y] = c(i + 0.5, j + 0.5);
    out.push(<path key={key()} d={`M${(x - 9).toFixed(1)} ${(y - 1).toFixed(1)} q 4.5 -3 9 0 t 9 0`} stroke={P.waterLight} strokeWidth={1.5} fill="none" strokeLinecap="round" />);
  }
  for (const [i, j] of PATH) tile(i, j, P.path, 0, { stroke: P.pathEdge, strokeWidth: 0.6 });

  // A box standing on the ground: top, then the two faces the camera can see.
  const boxParts = (ci: number, cj: number, wi: number, wj: number, hh: number, colTop: string, colL: string, colR: string): ReactElement[] => {
    const top: [number, number][] = [c(ci, cj, -hh), c(ci + wi, cj, -hh), c(ci + wi, cj + wj, -hh), c(ci, cj + wj, -hh)];
    const left: [number, number][] = [c(ci, cj + wj, -hh), c(ci + wi, cj + wj, -hh), c(ci + wi, cj + wj), c(ci, cj + wj)];
    const right: [number, number][] = [c(ci + wi, cj, -hh), c(ci + wi, cj + wj, -hh), c(ci + wi, cj + wj), c(ci + wi, cj)];
    return [
      <polygon key={key()} points={pts(left)} fill={colL} />,
      <polygon key={key()} points={pts(right)} fill={colR} />,
      <polygon key={key()} points={pts(top)} fill={colTop} />,
    ];
  };

  // Things with height sort by depth so nearer ones overlap farther ones.
  const objects: { d: number; parts: ReactElement[] }[] = [];

  for (const [i, j, size] of trees) {
    const [x, y] = c(i + 0.5, j + 0.5);
    const r = 18 * size;
    const hgt = 22 * size;
    objects.push({ d: i + j, parts: [
      <ellipse key={key()} cx={x.toFixed(1)} cy={(y + 2).toFixed(1)} rx={(r * 0.9).toFixed(1)} ry={(r * 0.45).toFixed(1)} fill={P.treeShadow} />,
      <rect key={key()} x={(x - 4 * size).toFixed(1)} y={(y - hgt).toFixed(1)} width={(8 * size).toFixed(1)} height={hgt.toFixed(1)} rx={2} fill={P.treeTrunk} />,
      <circle key={key()} cx={x.toFixed(1)} cy={(y - hgt - r * 0.6).toFixed(1)} r={r.toFixed(1)} fill={P.treeA} />,
      <circle key={key()} cx={(x - r * 0.35).toFixed(1)} cy={(y - hgt - r * 0.9).toFixed(1)} r={(r * 0.62).toFixed(1)} fill={P.treeB} />,
    ] });
  }

  const shedI = -2.6;
  const shedJ = 0.2;
  if (hasShed) {
    const wi = 1.8, wj = 1.4, hh = 30, rh = 18;
    const ridgeA = c(shedI - 0.1, shedJ + wj / 2, -hh - rh);
    const ridgeB = c(shedI + wi + 0.1, shedJ + wj / 2, -hh - rh);
    objects.push({ d: shedI + shedJ, parts: [
      ...boxParts(shedI, shedJ, wi, wj, hh, P.shedWall, P.shedWall, P.shedWallDark),
      <polygon key={key()} points={pts([c(shedI - 0.1, shedJ - 0.1, -hh + 2), c(shedI + wi + 0.1, shedJ - 0.1, -hh + 2), ridgeB, ridgeA])} fill={P.shedRoofDark} />,
      <polygon key={key()} points={pts([ridgeA, ridgeB, c(shedI + wi + 0.1, shedJ + wj + 0.1, -hh + 2), c(shedI - 0.1, shedJ + wj + 0.1, -hh + 2)])} fill={P.shedRoof} />,
      <polygon key={key()} points={pts([c(shedI + 0.6, shedJ + wj, -18), c(shedI + 1.2, shedJ + wj, -18), c(shedI + 1.2, shedJ + wj, 0), c(shedI + 0.6, shedJ + wj, 0)])} fill={P.shedRoofDark} />,
    ] });
  } else {
    // Not owned yet: its place is marked, so the farm reads as unfinished.
    objects.push({ d: -99, parts: [
      <polygon key={key()} points={pts([c(shedI, shedJ), c(shedI + 1.8, shedJ), c(shedI + 1.8, shedJ + 1.4), c(shedI, shedJ + 1.4)])} fill="none" stroke={P.ghost} strokeWidth={1.8} strokeDasharray="6 5" />,
    ] });
  }

  if (hasHarvester) {
    const hi = COLS + 0.4;
    const hj = 0.6;
    const parts = [...boxParts(hi, hj, 1.3, 0.8, 18, P.harvBody, P.harvBody, P.harvDark), ...boxParts(hi + 0.7, hj + 0.1, 0.5, 0.6, 30, P.harvGlass, P.harvGlass, P.harvDark)];
    for (const [wi, wj] of [[hi + 0.2, hj + 0.8], [hi + 1.1, hj + 0.8], [hi + 1.3, hj + 0.15]]) {
      const [wx, wy] = c(wi, wj);
      parts.push(<ellipse key={key()} cx={wx.toFixed(1)} cy={(wy - 2).toFixed(1)} rx={6} ry={6.5} fill={P.harvWheel} />);
    }
    objects.push({ d: hi + hj, parts });
  }

  objects.sort((a, b) => a.d - b.d);
  for (const o of objects) if (o.d < 0) out.push(...o.parts);

  // The raised bed: two side faces, the top, then the furrows.
  for (let i = 0; i < COLS; i++) poly([c(i, ROWS, -LIFT), c(i + 1, ROWS, -LIFT), c(i + 1, ROWS), c(i, ROWS)], P.soilL);
  for (let j = 0; j < ROWS; j++) poly([c(COLS, j, -LIFT), c(COLS, j + 1, -LIFT), c(COLS, j + 1), c(COLS, j)], P.soilR);
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) tile(i, j, P.soilTop, -LIFT);
  for (let j = 0; j < ROWS; j++) line(c(0.15, j + 0.5, -LIFT), c(COLS - 0.15, j + 0.5, -LIFT), P.furrow, 2.2);

  // Irrigation: the channel only runs once the equipment is in.
  //
  // Asked of the equipment directly, the way the shed and the harvester are.
  // This was a tier number, which happened to agree because irrigation is what
  // unlocks tier 3 — but it meant the picture was reading a rule's consequence
  // instead of the thing it is drawing, and would have quietly gone wrong the
  // moment that number moved in rules.ts.
  if (hasIrrigation) {
    for (let i = 0; i < COLS; i++) tile(i, ROWS, P.water, 0, { stroke: P.waterEdge, strokeWidth: 0.8 });
    for (let i = 0; i < COLS; i++) {
      const [x, y] = c(i + 0.5, ROWS + 0.5);
      out.push(<path key={key()} d={`M${(x - 10).toFixed(1)} ${(y - 1).toFixed(1)} q 5 -3 10 0 t 10 0`} stroke={P.waterLight} strokeWidth={1.6} fill="none" strokeLinecap="round" />);
    }
  }

  // Fence: goes up once there is something worth fencing.
  if (tier >= 2) {
    const post = ([x, y]: [number, number]) => line([x, y - LIFT], [x, y - LIFT - 16], P.fence, 2.6);
    const rail = (a: [number, number], b: [number, number], dy: number) =>
      line([a[0], a[1] - LIFT - dy], [b[0], b[1] - LIFT - dy], P.fence, 1.8);
    const backRight: [number, number][] = [];
    for (let i = 0; i <= COLS; i++) backRight.push(c(i, 0));
    const backLeft: [number, number][] = [];
    for (let j = 0; j <= ROWS; j++) backLeft.push(c(0, j));
    for (const edge of [backLeft, backRight]) {
      for (let k = 0; k < edge.length - 1; k++) {
        rail(edge[k]!, edge[k + 1]!, 12);
        rail(edge[k]!, edge[k + 1]!, 6);
      }
      for (const p of edge) post(p);
    }
  }

  // The crop. Two plants a tile, drawn back to front. Heads arrive at tier 3,
  // and a taller, denser stand at tier 4 and up.
  //
  // These two stay plain numbers on purpose. They are not a rule wearing a
  // disguise — nothing in rules.ts says a crop grows heads — they are how this
  // drawing spends the five tiers it is given. Pointing them at the equipment
  // table would tie the artwork to costs it has no business knowing.
  const heads = tier >= 3;
  const lush = tier >= 4;
  const plants: [number, number][] = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      plants.push([i + 0.28, j + 0.5]);
      plants.push([i + 0.72, j + 0.5]);
      if (lush) plants.push([i + 0.5, j + 0.78]);
    }
  }
  plants.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[1] - b[1]);
  for (const [pi, pj] of plants) {
    const i = Math.floor(pi);
    const j = Math.floor(pj);
    const jitter = ((i * 7 + j * 13) % 5) - 2;
    const [x, y] = c(pi, pj, -LIFT + 2);
    const hgt = heads ? (lush ? 26 : 22) + ((i + j) % 3) * 2 : 12 + ((i + j) % 3);
    out.push(
      <g key={key()} transform={`translate(${(x + jitter).toFixed(1)} ${y.toFixed(1)})`}>
        <path d={`M0 0 v-${hgt}`} stroke={heads ? P.stalk : P.sprout} strokeWidth={2.4} strokeLinecap="round" fill="none" />
        <path d={`M0 -${Math.round(hgt * 0.45)} q -7 -3 -9 -9`} stroke={P.stalkDark} strokeWidth={1.8} strokeLinecap="round" fill="none" />
        <path d={`M0 -${Math.round(hgt * 0.6)} q 7 -3 9 -8`} stroke={P.stalkDark} strokeWidth={1.8} strokeLinecap="round" fill="none" />
        {heads ? (
          <>
            <ellipse cx={0} cy={-(hgt + 5)} rx={4} ry={7.5} fill={P.head} />
            <path d={`M-2 -${hgt + 9} v8 M2 -${hgt + 9} v8`} stroke={P.headDark} strokeWidth={1} strokeLinecap="round" />
          </>
        ) : null}
      </g>,
    );
  }

  for (const o of objects) if (o.d >= 0) out.push(...o.parts);

  return out;
}
