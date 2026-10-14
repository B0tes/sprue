"""Fit check (not a part): bought-part envelopes vs the printed parts, and the printed parts vs each
other. Run: python3 cad/_fitcheck.py from the product folder. Every line should read 0; the
envelopes are approximate boxes and cylinders taken from the params and BOM sizes."""
import importlib, sys, math
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from build123d import *
from _params import *

parts = {k: importlib.import_module(k).make() for k in
         ["base-top", "base-bottom", "diffuser", "head-upper", "head-lower", "shutter"]}

def vol(a, b):
    try:
        r = a & b
        return r.volume
    except Exception as e:
        return f"err {e}"

def report(name, env, which):
    for w in which:
        v = vol(env, parts[w])
        flag = "" if isinstance(v, str) or v < 0.01 else "   <-- OVERLAP"
        print(f"{name:28s} vs {w:12s} {v if isinstance(v,str) else round(v,3)}{flag}")

# ---- head envelopes
cam_board = box(CAM_X0, CAM_X1, LENS_Y - 12.5, LENS_Y + 12.5, CAM_FRONT_Z, CAM_BACK_Z)
for hx, hy in CAM_HOLES:
    cam_board = cam_board - cyl(1.1, 0, 40, hx, hy)
lens = box(LENS_X - 5.4, LENS_X + 5.4, LENS_Y - 5.4, LENS_Y + 5.4, LENS_TIP_Z, CAM_FRONT_Z)
pi_stack = Pos((PI_X0 + PI_X1) / 2, (PI_Y0 + PI_Y1) / 2, PI_Z) * extrude(RectangleRounded(PI_L + 0.1, PI_W + 0.1, 3.0), 1.4 + 11 + 1.5 + 4)
sd = box(PI_X0 - 2.4, PI_X0 + 0.1, PI_Y0 + 9.5, PI_Y0 + 20.5, PI_Z + 1.4, PI_Z + 2.9)
nut = cyl(NUT_R, IZ1 - n("nutThicknessMm"), IZ1 - 0.01, NIP_X, NIP_Y)
nipple = cyl(n("pipeThreadOdMm") / 2, IZ1 - n("nutThicknessMm") - 1, HH + 6, NIP_X, NIP_Y)
coupling = cyl(n("couplingDiameterMm") / 2, HH + 0.01, HH + n("couplingHeightMm"), NIP_X, NIP_Y)
inside_len = n("toggleBodyLengthMm") - n("toggleLeverOutMm") - HWALL
toggle = hole_x(TOG_Y, TOG_Z, 4.6, IX - 2.0, IX - 0.01) + box(IX - 2.0 - inside_len, IX - 2.0, TOG_Y - TOG_W / 2, TOG_Y + TOG_W / 2, TOG_Z - TOG_H / 2, TOG_Z + TOG_H / 2)
leds = [hole_y(x, LED_Z, 2.9, IY - 1.0, IY - 0.01) + hole_y(x, LED_Z, 2.5, IY - 8.6, IY - 0.01) for x in (LED_GREEN_X, LED_RED_X)]
mics = [box(x - 8.35, x + 8.35, IY - 2.8, IY - 0.01, MIC_Z - 6.35, MIC_Z + 6.35) for x in MIC_XS]
head = ["head-upper", "head-lower"]
report("camera board+back", cam_board, head + ["shutter"])
report("camera lens housing", lens, head + ["shutter"])
report("pi+bonnet stack", pi_stack, head)
report("sd card", sd, head)
report("nut", nut, head)
report("nipple", nipple, head)
report("coupling", coupling, head)
report("toggle body", toggle, head)
# MAX98357A breakout (19.4 x 17.8 x 3.0) lying flat on the bonnet over the middle of the Pi, on 1 mm foam tape.
stack_top = PI_Z + 1.4 + 11 + 1.5 + 4
amp = box((PI_X0 + PI_X1) / 2 - 9.7, (PI_X0 + PI_X1) / 2 + 9.7, (PI_Y0 + PI_Y1) / 2 - 8.9, (PI_Y0 + PI_Y1) / 2 + 8.9, stack_top, stack_top + 1.0 + 3.0)
report("amp on bonnet", amp, head)
# 38 mm camera cable: an S-bend in the gap between the Pi's CSI end and the camera's FPC edge.
# The mini (22-pin) end is about 12 mm wide and centred on the Pi's width; the standard (15-pin) end is 16 mm wide on the camera's centre line.
pi_yc = (PI_Y0 + PI_Y1) / 2
cam_cable = box(PI_X1, (PI_X1 + CAM_X0) / 2, pi_yc - 6.0, pi_yc + 6.0, PI_Z + 1.0, CAM_FRONT_Z + 2.5) \
    + box((PI_X1 + CAM_X0) / 2, CAM_X0, LENS_Y - 8.0, LENS_Y + 8.0, PI_Z + 1.0, CAM_FRONT_Z + 2.5)
report("camera cable bend", cam_cable, head)
print("camera cable vs nut", round(vol(cam_cable, nut), 3), " vs nipple", round(vol(cam_cable, nipple), 3), " vs toggle", round(vol(cam_cable, toggle), 3))
for i, l in enumerate(leds): report(f"led {i}", l, head)
for i, m in enumerate(mics): report(f"mic {i}", m, head)
report("shutter closed", parts["shutter"], ["head-lower", "head-upper"])
opened = Pos(-SH_TRAVEL, 0, 0) * parts["shutter"]
print("shutter open vs head-lower", round(vol(opened, parts["head-lower"]), 3))
print("shutter open vs camera", round(vol(opened, cam_board + lens), 3), " vs pi", round(vol(opened, pi_stack), 3))
print("head-upper vs head-lower", round(vol(parts["head-upper"], parts["head-lower"]), 3))
print("toggle body vs camera", round(vol(toggle, cam_board + lens), 3), " vs nut", round(vol(toggle, nut), 3), " vs leds", round(vol(toggle, leds[0] + leds[1]), 3))
print("amp vs mics", round(vol(amp, mics[0] + mics[1]), 3), " vs nut", round(vol(amp, nut), 3), " amp top z", stack_top + 4.0, "inner top", IZ1)
# shutter covers window closed / clears it open
win = cyl(WIN_R, IZ0, IZ0 + 3, LENS_X, LENS_Y)
print("window covered closed (should be ~ full disc*2mm):", round(vol(win, parts["shutter"]), 2), "of", round(math.pi*WIN_R**2*SH_T, 2))
print("window covered open (should be 0):", round(vol(win, opened), 3))
print("lens tip z", LENS_TIP_Z, "shutter top", SH_TOP, "lip z", LIP_Z0, "board front", CAM_FRONT_Z, "back", CAM_BACK_Z)
print("toggle z", TOG_Z - TOG_H/2, TOG_Z + TOG_H/2, "inner top", IZ1)
print("nut z", IZ1 - n("nutThicknessMm"), "pi stack top", PI_Z + 1.4 + 11 + 1.5 + 4)
print("NIP", NIP_X, NIP_Y, "gap", PI_X1, CAM_X0, "LENS_X", LENS_X, "bosses", HEAD_BOSSES)

# ---- base envelopes
discs = cyl(DISC_R, COLUMN_BOTTOM - 2 * n("ballastDiscThicknessMm"), COLUMN_BOTTOM, ARM_X, ARM_Y) - cyl(n("ballastDiscHoleMm") / 2, 0, 50, ARM_X, ARM_Y)
nut_b = cyl(NUT_R, NUT_BOTTOM, RIB_TOP, ARM_X, ARM_Y) - cyl(n("pipeThreadOdMm")/2, 0, 50, ARM_X, ARM_Y)
# Base nipple screwed baseNippleEngagementMm into the coupling: its lower end sits this high.
pipe_bottom = COUPLING_BOTTOM + n("baseNippleEngagementMm") - n("baseNippleLengthMm")
nip_b = cyl(n("pipeThreadOdMm") / 2, pipe_bottom, COUPLING_BOTTOM + n("baseNippleEngagementMm"), ARM_X, ARM_Y)
coup_b = cyl(n("couplingDiameterMm") / 2, COUPLING_BOTTOM + 0.01, COUPLING_BOTTOM + n("couplingHeightMm"), ARM_X, ARM_Y)
spk = cyl(n("speakerDiameterMm") / 2, B_TOP_IN - n("speakerHeightMm"), B_TOP_IN - 0.01, SPK_X, SPK_Y)
talk = box(TALK_X - 9.03, TALK_X + 9.03, TALK_Y - 9, TALK_Y + 9, BH - n("talkButtonDepthMm"), B_TOP_IN - 0.01)
stick = box(STICK_X - 25.55, STICK_X + 25.55, STICK_Y - 5.11, STICK_Y + 5.11, DIFF_Z - 3.19, DIFF_Z - 0.01)
usb = box(USB_X - 10.2, USB_X + 10.2, USB_Y_BACK + 0.3, USB_Y_FRONT + 0.3 + 0.05, USB_BOARD_Z + 0.01, USB_BOARD_Z + 5)
# Board with 1.5 mm of trimmed leads below and up to 4.5 mm of parts above (the light-bar frame is over part of it).
jb = box(JB_X - 25.4, JB_X + 25.4, JB_Y - 21.5, JB_Y + 21.5, JB_Z - 1.5, JB_TOP + 4.5)
for x, y in JB_HOLES: jb = jb - cyl(n("junctionPostMm") / 2 + 0.01, JB_TOP - 0.01, 50, x, y) - cyl(1.6, 0, 50, x, y)
feet = union([cyl(4, -2, n("rubberFootPocketDepthMm") - 0.01, x, y) for x, y in FEET])
screws = union([cyl(1.5, BASE_CBORE_DEPTH + 0.01, BASE_CBORE_DEPTH + 8, x, y) + cyl(2.8, BASE_CBORE_DEPTH - M3_HEAD_H, BASE_CBORE_DEPTH, x, y) for x, y in BASE_BOSSES])
base = ["base-top", "base-bottom", "diffuser"]
for nm, e in [("discs", discs), ("nut", nut_b), ("nipple", nip_b), ("coupling", coup_b), ("speaker", spk),
              ("talk button", talk), ("neopixel stick", stick), ("usb-c breakout", usb), ("junction board", jb),
              ("feet", feet), ("screws (shank+head)", screws)]:
    report(nm, e, base)
print("base-top vs base-bottom", round(vol(parts["base-top"], parts["base-bottom"]), 3))
print("base-top vs diffuser", round(vol(parts["base-top"], parts["diffuser"]), 3))
print("base nipple end", round(pipe_bottom, 2), "nut", round(NUT_BOTTOM, 2), "-", RIB_TOP, "harness floor", HARNESS_FLOOR,
      "exit gap", round(pipe_bottom - HARNESS_FLOOR, 2), "need", n("harnessExitClearanceMm"))
print("disc top", DISC_TOP, "junction board underside", JB_Z, "gap", round(JB_Z - DISC_TOP, 2),
      "stake bottom", JB_Z - n("junctionPinStakeMm"))
print("disc bottom", COLUMN_BOTTOM - 12.7, "rib top", RIB_TOP, "column bottom", COLUMN_BOTTOM, "pad top", BASE_PAD_TOP, "USB_Z", USB_Z)
