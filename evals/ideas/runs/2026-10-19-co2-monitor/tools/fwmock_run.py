"""Stage 3 hand check: run software/code.py on the host against stand-ins for CircuitPython's modules.

The SCD4x stand-in refuses what the datasheet's command table refuses during periodic measurement. This checks the
code's flow (boot order, error paths, the light mix); it does not check CircuitPython's real API or the I2C bus."""
import sys, types

CODE = sys.argv[1]
results = []

class Stop(Exception):
    pass

def run(found, ppms, mutate=None, co2_error_at=None):
    src = open(CODE).read()
    if mutate:
        src = mutate(src)
    log = {"light": [], "text": [], "print": []}
    mods = {}
    def mod(name, **kw):
        m = types.ModuleType(name); m.__dict__.update(kw); mods[name] = m; return m
    ticks = {"n": 0}
    def sleep(s):
        ticks["n"] += 1
        if ticks["n"] > 2 * len(ppms) + 2:
            raise Stop()
    mod("time", sleep=sleep, monotonic=lambda: ticks["n"])
    mod("board", GP4="GP4", GP5="GP5", GP14="GP14", GP15="GP15")
    class I2C:
        def __init__(self, scl, sda, frequency=100000):
            assert (scl, sda) == ("GP5", "GP4"), (scl, sda)
        def try_lock(self): return True
        def unlock(self): pass
        def scan(self): return list(found)
    mod("busio", I2C=I2C)
    class PWMOut:
        def __init__(self, pin, frequency=500, duty_cycle=0):
            self.pin, self._d = pin, duty_cycle
        @property
        def duty_cycle(self): return self._d
        @duty_cycle.setter
        def duty_cycle(self, v):
            assert 0 <= v <= 65535 and isinstance(v, int), v
            self._d = v
            log["light"].append((self.pin, v))
    mod("pwmio", PWMOut=PWMOut)
    class Group(list):
        pass
    mod("displayio", release_displays=lambda: None, Group=Group)
    mod("terminalio", FONT="font")
    class Label:
        def __init__(self, font, text="", **kw):
            self._t = text
        @property
        def text(self): return self._t
        @text.setter
        def text(self, v):
            assert isinstance(v, str)
            self._t = v; log["text"].append(v)
    dt = mod("adafruit_display_text"); dt.label = mod("adafruit_display_text.label", Label=Label)
    class I2CDisplayBus:
        def __init__(self, i2c, device_address):
            assert device_address in found
    mod("i2cdisplaybus", I2CDisplayBus=I2CDisplayBus)
    class SSD1306:
        def __init__(self, bus, width, height):
            assert (width, height) == (128, 64)
            self.root_group = None
    mod("adafruit_displayio_ssd1306", SSD1306=SSD1306)
    seq = iter(ppms)
    class SCD4X:
        def __init__(self, i2c, address=0x62):
            self.periodic = False; self._ready = 0; self._reads = 0
        def _idle(self, what):
            if self.periodic:
                raise RuntimeError(f"{what}: not available in periodic measurement mode")
        def stop_periodic_measurement(self): self.periodic = False
        def start_periodic_measurement(self): self._idle("start"); self.periodic = True
        @property
        def serial_number(self): self._idle("serial_number"); return (0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc)
        @property
        def temperature_offset(self): self._idle("temperature_offset"); return 4.0
        @temperature_offset.setter
        def temperature_offset(self, v): self._idle("temperature_offset"); assert 0 <= v <= 20
        @property
        def data_ready(self):
            assert self.periodic, "data_ready before start"
            self._ready += 1
            return self._ready % 2 == 0
        @property
        def CO2(self):
            self._reads += 1
            if co2_error_at == self._reads:
                raise OSError(5, "Input/output error")
            try:
                return next(seq)
            except StopIteration:
                raise Stop()
        temperature = 23.46
        relative_humidity = 41.2
    mod("adafruit_scd4x", SCD4X=SCD4X)
    saved = {k: sys.modules.get(k) for k in mods}
    sys.modules.update(mods)
    g = {"__name__": "__main__", "print": lambda *a: log["print"].append(" ".join(map(str, a)))}
    try:
        exec(compile(src, CODE, "exec"), g)
        outcome = "ended"
    except Stop:
        outcome = "ran"
    except Exception as e:
        outcome = f"CRASH {type(e).__name__}: {e}"
    finally:
        for k, v in saved.items():
            if v is None: sys.modules.pop(k, None)
            else: sys.modules[k] = v
    return outcome, log, g

def light_pairs(log):
    out, cur = [], {}
    for pin, v in log["light"]:
        cur[pin] = v
        if pin == "GP15":
            out.append((round(cur.get("GP14", 0) / 65535, 2), round(cur["GP15"] / 65535, 2)))
    return out

ok = True
def check(name, cond, detail):
    global ok
    ok &= bool(cond)
    print(("PASS " if cond else "FAIL ") + name + ": " + detail)

ppms = [450, 1000, 1250, 1500, 1750, 2000, 3500]
o, log, g = run([0x3D, 0x62], ppms)
pairs = light_pairs(log)
check("boots and reads", o == "ran", o)
check("light mix (red, green) per reading", pairs[1:] == [(0.0, 1.0), (0.0, 1.0), (0.5, 1.0), (1.0, 1.0), (1.0, 0.5), (1.0, 0.0), (1.0, 0.0)],
      f"start {pairs[0]}, then {pairs[1:]} for {ppms} ppm")
check("screen text", "3500" in log["text"] and any("C" in t and "%RH" in t for t in log["text"]), f"last texts {log['text'][-2:]}")
o, log, _ = run([0x3C, 0x62], [800])
check("OLED at 0x3C", o == "ran", o)
o, log, _ = run([0x62], [800])
check("no OLED: still runs the light", o == "ran" and light_pairs(log)[-1] == (0.0, 1.0), f"{o}, prints {log['print'][:1]}")
o, log, g = run([0x3D], [800])
check("no sensor: says so, red", o == "ran" and "no CO2 sensor" in log["text"] and light_pairs(log)[-1] == (1.0, 0.0), f"{o}, texts {log['text']}")
o, log, _ = run([0x3D, 0x62], [800, 900], co2_error_at=1)
check("read error shown, keeps going", o == "ran" and "err" in log["text"] and "800" in log["text"] or "900" in log["text"], f"{o}, texts {log['text']}")
old = lambda s: s.replace('print("SCD4x serial", [hex(b) for b in scd.serial_number])\n', "").replace(
    "scd.start_periodic_measurement()  # a new reading every 5 s",
    'scd.start_periodic_measurement()  # a new reading every 5 s\nprint("SCD40 serial", scd.serial_number)')
o, log, _ = run([0x3D, 0x62], [800], mutate=old)
check("self-test: the stage 1 order (serial after start) is caught", o.startswith("CRASH RuntimeError"), o)
print("ALL PASS" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)
