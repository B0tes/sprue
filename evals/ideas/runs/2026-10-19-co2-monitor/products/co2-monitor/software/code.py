# Desk CO2 monitor: CircuitPython for the Raspberry Pi Pico.
# Reads the SCD40 every 5 s, shows CO2, temperature and humidity on the OLED, and fades the red/green LED.
# Needs in CIRCUITPY/lib (Adafruit CircuitPython bundle, same version as CircuitPython):
#   adafruit_scd4x.mpy, adafruit_displayio_ssd1306.mpy, adafruit_display_text/, adafruit_bus_device/
# The numbers below come from design.json -> params; change them there and here together.
import time

import board
import busio
import displayio
import pwmio
import terminalio
import adafruit_scd4x
import adafruit_displayio_ssd1306
from adafruit_display_text import label

try:  # CircuitPython 9 and later
    from i2cdisplaybus import I2CDisplayBus
except ImportError:  # CircuitPython 8
    from displayio import I2CDisplay as I2CDisplayBus

GREEN_BELOW_PPM = 1000   # co2GreenBelowPpm (UBA: under 1000 ppm harmless)
RED_FROM_PPM = 2000      # co2RedFromPpm (UBA: over 2000 ppm unacceptable)
TEMP_OFFSET_C = 4.0      # the SCD40's default; raise it if the screen reads warmer than a thermometer beside it
I2C_HZ = 100_000         # i2cKhz x 1000
OLED_ADDRESSES = (0x3D, 0x3C)  # Adafruit 326: 0x3D, or 0x3C with its jumper closed
LED_PWM_HZ = 1000

# Light: GP14 -> 390 ohm -> red anode, GP15 -> 390 ohm -> green anode (PWM slice 7, A and B).
red = pwmio.PWMOut(board.GP14, frequency=LED_PWM_HZ, duty_cycle=0)
green = pwmio.PWMOut(board.GP15, frequency=LED_PWM_HZ, duty_cycle=0)


def set_light(r, g):
    """r and g from 0 to 1."""
    red.duty_cycle = int(max(0.0, min(1.0, r)) * 65535)
    green.duty_cycle = int(max(0.0, min(1.0, g)) * 65535)


def light_for(ppm):
    """Green under GREEN_BELOW_PPM, red from RED_FROM_PPM, through yellow in between."""
    t = (ppm - GREEN_BELOW_PPM) / (RED_FROM_PPM - GREEN_BELOW_PPM)
    t = max(0.0, min(1.0, t))
    return min(1.0, 2 * t), min(1.0, 2 * (1 - t))


set_light(0.3, 0.3)  # dim yellow while it starts

# I2C0 on GP5 (SCL) and GP4 (SDA); the SCD-40 breakout's pull-ups serve both boards.
displayio.release_displays()
i2c = busio.I2C(board.GP5, board.GP4, frequency=I2C_HZ)
while not i2c.try_lock():
    pass
found = i2c.scan()
i2c.unlock()
print("I2C devices:", [hex(a) for a in found])

oled_address = next((a for a in OLED_ADDRESSES if a in found), None)
screen = None
if oled_address is None:
    print("No OLED at 0x3D or 0x3C: check the STEMMA QT cable")
else:
    bus = I2CDisplayBus(i2c, device_address=oled_address)
    screen = adafruit_displayio_ssd1306.SSD1306(bus, width=128, height=64)
    group = displayio.Group()
    co2_text = label.Label(terminalio.FONT, text="----", scale=3, anchor_point=(1.0, 0.0), anchored_position=(100, 2))
    unit_text = label.Label(terminalio.FONT, text="ppm", anchor_point=(0.0, 0.0), anchored_position=(104, 26))
    climate_text = label.Label(terminalio.FONT, text="warming up", anchor_point=(0.5, 1.0), anchored_position=(64, 63))
    for item in (co2_text, unit_text, climate_text):
        group.append(item)
    screen.root_group = group


def show(co2, climate):
    print(co2, climate)
    if screen is not None:
        co2_text.text = co2
        climate_text.text = climate


if 0x62 not in found:
    show("----", "no CO2 sensor")
    set_light(1, 0)
    while True:
        time.sleep(1)

scd = adafruit_scd4x.SCD4X(i2c)
scd.stop_periodic_measurement()  # it may still be measuring after a soft reboot; settings change only when stopped
# The serial number and the offset are refused during periodic measurement (SCD4x datasheet, command table), so
# both come before start_periodic_measurement().
print("SCD4x serial", [hex(b) for b in scd.serial_number])
scd.temperature_offset = TEMP_OFFSET_C
scd.start_periodic_measurement()  # a new reading every 5 s

while True:
    try:
        if scd.data_ready:
            ppm = scd.CO2
            show(str(ppm), "{:.1f} C  {:.0f} %RH".format(scd.temperature, scd.relative_humidity))
            set_light(*light_for(ppm))
    except (OSError, RuntimeError) as e:  # a loose wire or a bad CRC: say so, keep trying
        show("err", str(e)[:21])
        set_light(1, 0)
    time.sleep(1)
