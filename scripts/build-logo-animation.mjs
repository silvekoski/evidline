import { readFileSync, writeFileSync } from "node:fs";

// Keep the animation's Bezier paths identical to the supplied SVG artwork.
// This converter deliberately accepts only the absolute commands in these assets.
function readArtwork(name) {
  const svg = readFileSync(new URL(`../apps/web/src/assets/${name}.svg`, import.meta.url), "utf8");
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const commands = svg.match(/ d="([^"]+)"/)[1].match(/[A-Za-z]|-?\d*\.?\d+/g);
  const paths = [];
  let shape;
  let cursor = 0;
  const point = () => [Number(commands[cursor++]), Number(commands[cursor++])];
  const relative = (a, b) => a.map((value, index) => Number((value - b[index]).toFixed(2)));
  const vertex = (value, incoming = [0, 0]) => {
    shape.v.push(value);
    shape.i.push(incoming);
    shape.o.push([0, 0]);
  };

  while (cursor < commands.length) {
    const command = commands[cursor++];
    if (command === "M") {
      shape = { c: true, v: [], i: [], o: [] };
      paths.push(shape);
      vertex(point());
    } else if (command === "L") {
      vertex(point());
      // SVG permits additional coordinate pairs after one L command.
      while (cursor < commands.length && !/^[A-Za-z]$/.test(commands[cursor])) vertex(point());
    } else if (command === "C") {
      const first = point();
      const second = point();
      const end = point();
      shape.o[shape.v.length - 1] = relative(first, shape.v.at(-1));
      vertex(end, relative(second, end));
    } else if (command !== "Z") {
      throw new Error(`Unsupported SVG command: ${command}`);
    }
  }

  return { paths, viewBox };
}

const fixed = (k) => ({ a: 0, k });
const tween = (start, end, from, to, linear = false) => ({
  a: 1,
  k: [
    { t: start, s: from, e: to, o: { x: linear ? 0.33 : 0.22, y: linear ? 0.33 : 1 }, i: { x: linear ? 0.67 : 0.36, y: linear ? 0.67 : 1 } },
    { t: end, s: to },
  ],
});

const transform = (opacity = fixed(100)) => ({
  ty: "tr", p: fixed([0, 0]), a: fixed([0, 0]), s: fixed([100, 100]), r: fixed(0), o: opacity, sk: fixed(0), sa: fixed(0),
});
const fill = (opacity = fixed(100)) => ({ ty: "fl", c: fixed([1, 1, 1, 1]), o: opacity, r: 2, bm: 0 });
const stroke = (width) => ({ ty: "st", c: fixed([1, 1, 1, 1]), o: fixed(100), w: fixed(width), lc: 2, lj: 2, bm: 0 });
const trim = (start, end) => ({ ty: "tm", s: start, e: end, o: fixed(0), m: 1 });
const group = (name, shapes, opacity) => ({ ty: "gr", nm: name, it: [...shapes, transform(opacity)] });

// Measure once at build time. Native SVG dashes can reveal the exact same
// Bezier outlines without Lottie rebuilding their geometry on every frame.
function pathLength(path) {
  let length = 0;
  const segments = path.c ? path.v.length : path.v.length - 1;
  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % path.v.length;
    const from = path.v[index];
    const to = path.v[next];
    let previous = from;
    for (let sample = 1; sample <= 150; sample++) {
      const t = sample / 150;
      const point = from.map((value, axis) =>
        (1 - t) ** 3 * value +
        3 * (1 - t) ** 2 * t * (value + path.o[index][axis]) +
        3 * (1 - t) * t ** 2 * (to[axis] + path.i[next][axis]) +
        t ** 3 * to[axis],
      );
      length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
      previous = point;
    }
  }
  return Number(length.toFixed(4));
}

function build(name, groups) {
  const { paths, viewBox: [x, y, w, h] } = readArtwork(name);
  const isMark = name === "evidline-mark";
  const outline = (indices) => indices.map((path) => ({ ty: "sh", ks: fixed(paths[path]) }));
  let layerId = 0;
  const layer = (label, shapes, overrides = {}) => ({
    ddd: 0, ind: ++layerId, ty: 4, nm: label, sr: 1, ip: 0, op: 66, st: 0, bm: 0,
    ks: { o: fixed(100), p: fixed([-x, -y, 0]), a: fixed([0, 0, 0]), s: fixed([100, 100, 100]), r: fixed(0), ...overrides },
    shapes,
  });
  const letters = groups.map(([label, indices], index) => {
    const start = index * 5;
    return layer(label, [
      group(`${label} solid`, [...outline(indices), fill(tween(start + 14, start + 30, [12], [100]))]),
      group(`${label} traced outline`, indices.map((path) => {
        const length = pathLength(paths[path]);
        return group(`${label} contour ${path}`, [
          ...outline([path]),
          {
            ...stroke(5),
            // Hide zero-length round caps at the exact first frame.
            o: tween(start, start + 0.001, [0], [100], true),
            d: [
              { n: "d", v: fixed(length) },
              { n: "g", v: fixed(length + 1) },
              { n: "o", v: tween(start, start + 24, [length], [0]) },
            ],
          },
        ]);
      }), tween(start + 22, start + 32, [100], [0])),
    ]);
  });

  // A moving signal follows the e crossbar, the v notch, and the two i dots.
  // Its short tail disappears as the outlined letters resolve into solid artwork.
  const route = isMark
    ? [[66, 164], [178, 164], [154, 102], [94, 85], [35, 124], [24, 184], [64, 233], [126, 236], [169, 211]]
    : [[66, 164], [177, 164], [219, 94], [286, 246], [352, 94], [413, 94], [413, 28], [413, 165], [550, 165], [627, 94], [694, 20], [694, 165], [763, 165], [763, 28], [763, 165], [890, 108], [960, 165], [1154, 165]];
  const signalShape = { c: false, v: route, i: route.map(() => [0, 0]), o: route.map(() => [0, 0]) };
  const distances = [0];
  for (let index = 1; index < route.length; index++) {
    distances.push(distances.at(-1) + Math.hypot(route[index][0] - route[index - 1][0], route[index][1] - route[index - 1][1]));
  }
  const travelFrames = isMark ? 30 : 46;
  const positions = route.map(([px, py], index) => {
    const position = [px - x, py - y, 0];
    if (index === route.length - 1) return { t: travelFrames, s: position };
    return {
      t: distances[index] / distances.at(-1) * travelFrames,
      s: position, e: [route[index + 1][0] - x, route[index + 1][1] - y, 0],
      o: { x: 0.33, y: 0.33 }, i: { x: 0.67, y: 0.67 },
    };
  });
  const signal = layer("Evidence signal", [group("Traveling trace", [
    { ty: "sh", ks: fixed(signalShape) }, stroke(7),
    trim(tween(7, travelFrames + 7, [0], [100], true), tween(0, travelFrames, [0], [100], true)),
  ])], { o: tween(travelFrames, travelFrames + 8, [85], [0]) });
  const point = layer("Signal point", [group("Point", [
    { ty: "el", p: fixed([0, 0]), s: fixed([16, 16]), d: 1 }, fill(),
  ])], { p: { a: 1, k: positions }, o: tween(travelFrames - 1, travelFrames + 5, [100], [0]) });

  const dots = isMark ? [] : [[8, 413, 28, 17], [9, 763, 28, 35]].map(([path, px, py, start]) =>
    layer("Evidence point locks in", [group("i dot", [...outline([path]), fill()])], {
      a: fixed([px, py, 0]), p: fixed([px - x, py - y, 0]),
      s: tween(start, start + 15, [35, 35, 100], [100, 100, 100]),
      o: tween(start, start + 10, [12], [100]),
    }),
  );

  const animation = {
    // Preserve the original drawing sequence with a slightly quicker 0.88s playback.
    v: "5.12.2", fr: 75, ip: 0, op: 66, w, h, nm: `${name} · evidence trace`, ddd: 0, assets: [],
    layers: [point, signal, ...dots, ...letters],
  };
  writeFileSync(new URL(`../apps/web/src/assets/${name}.json`, import.meta.url), `${JSON.stringify(animation)}\n`);
}

// Keep counters with their outlines and preserve the connected i/n/e ligature.
build("evidline-logo", [["e", [1]], ["v", [0]], ["i", [4]], ["d", [2, 6]], ["l", [5]], ["ine", [3, 7]]]);
build("evidline-mark", [["e", [0]]]);
