export interface ClimbRateLeverOptions {
  onChange(value: number): void;
  getCommand(): number;
  climbMps: number;
  descentMps: number;
}

/** Spring-centered vertical velocity command. Motor power belongs to the controller. */
export function createClimbRateLever(host: HTMLElement, options: ClimbRateLeverOptions) {
  const doc = host.ownerDocument;
  const label = doc.createElement("label");
  label.className = "flight-climb-rate";
  label.innerHTML = `<span>CLIMB</span><output>0.0 m/s</output><input type="range" min="-1" max="1" step="0.01" value="0" aria-label="Climb / descent rate. Release to hold altitude." aria-orientation="vertical" />`;
  const input = label.querySelector("input")!;
  const output = label.querySelector("output")!;
  input.style.writingMode = "vertical-lr";
  input.style.direction = "rtl";
  let held = false;
  const paint = (value: number) => {
    input.value = String(value);
    const rate = value * (value >= 0 ? options.climbMps : options.descentMps);
    output.value = `${rate > 0 ? "+" : ""}${rate.toFixed(1)} m/s`;
    input.setAttribute("aria-valuetext", rate === 0 ? "Hold altitude" : `${Math.abs(rate).toFixed(1)} metres per second ${rate > 0 ? "climb" : "descent"}`);
  };
  const change = () => { options.onChange(Number(input.value)); paint(Number(input.value)); };
  const release = () => { held = false; options.onChange(0); paint(0); };
  const down = (event: PointerEvent) => { held = true; input.setPointerCapture?.(event.pointerId); };
  const keyDown = (event: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"].includes(event.key)) held = true;
  };
  const keyUp = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"].includes(event.key)) release(); };
  input.addEventListener("input", change);
  input.addEventListener("pointerdown", down);
  input.addEventListener("keydown", keyDown);
  input.addEventListener("keyup", keyUp);
  for (const name of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) input.addEventListener(name, release);
  doc.defaultView?.addEventListener("blur", release);
  host.append(label);
  paint(0);
  return {
    update() { if (!held) paint(options.getCommand()); },
    destroy() {
      release();
      doc.defaultView?.removeEventListener("blur", release);
      label.remove();
    },
  };
}
