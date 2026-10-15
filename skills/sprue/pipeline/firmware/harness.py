# The firmware in the loop's code.py (fil.ts puts it on the emulated Pico's CIRCUITPY drive). It is not the firmware:
# it runs the firmware under test, firmware.py (products/<slug>/firmware/code.py, unchanged), as __main__, with one
# KMK module more. rp2040js has no USB host that reads keyboard reports, so that module prints on the serial console
# each keyboard report the firmware hands to the USB HID device, as hex, and says when the keyboard is ready.
# Lines it prints start with "SPRUE", which nothing else prints. This file runs on CircuitPython, not on the
# computer's Python.

from kmk.hid import KeyboardReport
from kmk.kmk_keyboard import KMKKeyboard
from kmk.modules import Module
from kmk.utils import Debug

# KMK prints a debug line for every key event whenever a serial terminal is open, and the emulator's USB host always
# has one open; a keypad on a desk has none, so its debug output is off here as it would be there (it only prints).
Debug("sprue").enabled = False


class Tap:
    """Stands in for the USB HID device of the keyboard report: prints each report, then sends it on."""

    def __init__(self, device):
        self.device = device

    def send_report(self, buffer, *args):
        print("SPRUE HID", len(buffer), bytes(buffer).hex())
        return self.device.send_report(buffer, *args)


class Watch(Module):
    """Taps the keyboard report once KMK has set up its HID devices, and then says the keyboard is ready."""

    def __init__(self):
        self.ready = False

    def during_bootup(self, keyboard):
        pass

    def before_matrix_scan(self, keyboard):
        pass

    def after_matrix_scan(self, keyboard):
        pass

    def process_key(self, keyboard, key, is_pressed, int_coord):
        print("SPRUE KEY", int_coord, getattr(key, "code", -1), 1 if is_pressed else 0)
        return key

    def before_hid_send(self, keyboard):
        if self.ready:
            return
        devices = keyboard._hid_helper.device_map
        for report in list(devices.keys()):
            if isinstance(report, KeyboardReport) and not isinstance(devices[report], Tap):
                devices[report] = Tap(devices[report])
                self.ready = True
                print("SPRUE READY", len(report.buffer))

    def after_hid_send(self, keyboard):
        pass

    def on_powersave_enable(self, keyboard):
        pass

    def on_powersave_disable(self, keyboard):
        pass


_go = KMKKeyboard.go


def go(self, *args, **kwargs):
    self.modules.append(Watch())
    return _go(self, *args, **kwargs)


KMKKeyboard.go = go
print("SPRUE BOOT")
with open("/firmware.py") as f:
    source = f.read()
exec(source, {"__name__": "__main__"})
print("SPRUE EXIT")
