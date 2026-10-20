#!/bin/bash
repos="3b1b/manim ManimCommunity/manim motion-canvas/motion-canvas remotion-dev/remotion airbnb/lottie-web rive-app/rive-runtime greensock/GSAP d3/d3 processing/p5.js mrdoob/three.js vectorgraphics/asymptote pgf-tikz/pgf blender/blender matplotlib/matplotlib processing/processing pixijs/pixijs showlab/Code2Video SuienS/manim-trainer redotvideo/revideo JuliaAnimators/Javis.jl manim-kindergarten/manim_slides jsxgraph/jsxgraph lottie-react-native/lottie-react-native"
out=gh_repos_raw.jsonl
: > "$out"
for r in $repos; do
  echo "== $r" >&2
  curl -s -m 25 "https://api.github.com/repos/$r" >> "$out"
  echo >> "$out"
  sleep 1
done
