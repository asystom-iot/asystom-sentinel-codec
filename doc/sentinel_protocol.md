# Sentinel protocol reference

This guide describes Sentinel uplink payloads and the fields returned by the
example codecs. Use the basic codec for stateless LNS decoding, or the
full-fledged codec when FFT zoom decoding and persistent device settings are
needed.

## Payload structure

A scalar measurement occupies three bytes: an indicator ID followed by an
unsigned 16-bit little-endian value. A payload may contain scalars followed by
one vector. The LoRaWAN FPort counts the scalars plus the vector, if present.

Payloads containing exactly three bytes per declared element are decoded as
scalars. Longer payloads are decoded as scalars followed by one vector; shorter
payloads are rejected. Indicator IDs are interpreted after this classification.
An unrecognized ID in a scalar-sized payload is reported as an unidentified
scalar, even if its value matches a vector identifier.

Vector identifiers are `0x0b` for a signature, `0x0d` for FFT zoom data, and
`0xff` for a system-status report. A status-only uplink uses FPort 1 and is
84 bytes long, including its identifier.

Decoded values and settings are returned under `data`. Check `errors` before
using a result; `warnings` describe conditions such as an incomplete split
frame or an unsupported measurement.

## System-status report

The status body after `0xff` is exactly 83 bytes. Offsets below exclude the
identifier. Once a payload is identified as a status vector, a body length
other than 83 bytes returns an error.

| Offset | Bytes | Contents |
| --- | --- | --- |
| 0 | 1 | Version-health error mask: bit 0 controller/radios, bit 1 sensor |
| 1 | 1 | Radio-stack status |
| 2 | 2 | System reset-source mask, **big endian** |
| 4 | 5 | ASCII firmware version |
| 9 | 10 | Scheduling settings |
| 19 | 32 | Measurement settings |
| 51 | 6 | Radio settings |
| 57 | 26 | Extension settings |

All settings integers are unsigned little endian. The reset-source mask is the
exception shown above. Firmware information is returned under
`data.firmwareVersion` and `data.firmwareStatus`.

`mainRadiosVersionError` and `sensorVersionError` indicate version-compatibility
errors in the controller/radios and sensor respectively. `radioStatus` is a
separate diagnostic code, described by `softwareStatus`. `lastBootCauses` lists
decoded reset causes. Unknown radio-status codes and reserved status bits remain
available as raw values.

## Scheduling settings

The 10-byte block is decoded under `data.schedulingSettings`.

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | uint32 | Indicator activation bitmask |
| 4 | uint16 | Ambient periodicity, 10 seconds per step |
| 6 | uint16 | Prediction periodicity, 10 seconds per step |
| 8 | uint16 | Introspection periodicity, 10 seconds per step |

The output includes the raw hex `activationBitmask`, numeric `activationMask`,
`activeIndicators`, `reservedActivationMask`, and periodicities in seconds.
Indicator IDs are 0 Battery, 1 Current loop, 3 Magnet, 8 Wake-on event,
11 Signature, 13 Extension, 14 Temperature, 20 System check, and 21 Settings
reader. Other activation bits are reserved.

## Advanced settings

The 38-byte block is decoded under `data.advancedSettings`. Its first 32 bytes
contain measurement settings; the final six bytes contain radio settings.
Offsets below are relative to this block.

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | uint32 bitfields | Sensor mask in bits 0-7; orientation mask in bits 8-31 |
| 4, 6 | uint16 each | Sonic high/low frequencies, 10 Hz per step |
| 8, 10 | uint16 each | Vibration high/low frequencies, Hz |
| 12, 14 | uint16 each | Rotation-speed search high/low frequencies, Hz; decoded output is RPM |
| 16, 18 | uint16 each | Reserved fields: `reserved0`, `reserved1` |
| 20, 22 | uint16 each | Custom spectrum type and parameter |
| 24 | uint32 bitfields | Wake-on-event mode: 4 bits; flag: 1; parameter: 11; profile: 2; threshold: 14 |
| 28, 30 | uint16 each | Wake-on-event pre-trigger and post-trigger values |
| 32 | uint16 bitfields | ADR, ACK, private network, coding rate, dwell time, retry, packet split, then 9 reserved bits |
| 34 | uint16 | Region-dependent frequency setting |
| 36 | uint16 | Radio link-check period in seconds |

### Sensors and orientation

`sensorInformation.enumeration` is an array of selected sensor names.
`orientationMask` preserves all 24 orientation bits, and `orientation` is an
array of selected axes. Zero masks produce `NoSensor` and `NoOrientation`.

| Sensor bit | Name |
| --- | --- |
| 1 | InternalAccelerometer |
| 2 | ExternalAccelerometer |
| 4 | InternalMicrophone |
| 8 | ExternalMicrophone |
| 16 | WeatherSensor |
| 32 | ShockDetection |
| 64 | RtdSensor |
| 128 | TcSensor |

Sensor bits are combinable. Orientation bits 1, 2, and 4 select X, Y, and Z.
Higher orientation bits are reserved and preserved as raw values. A mask value
identifies a selection; it does not establish that a sensor is fitted or active
on your device.

### Wake-on-event and radio fields

Wake-on-event modes 0-5 are Inactive, MotionTrig, MotionTrigAuto, SchedulerTrig,
AnalogTrig, and ContactTrig. Profiles 0-3 are LowPower, MidPower1, MidPower2, and
HighPower. Decoded values are under `wakeOnEventInformation`; `woeBitmask`
contains the four mode/threshold bytes as hex.

The radio coding-rate flag is 0 for 4/5 and 1 for 4/8.
`lorawanConfig.reserved` preserves the nine reserved radio flag bits.

## Extension settings and FFT zoom

The 26-byte settings block is decoded under `data.extensionSettings`.

| Offset | Type | Meaning |
| --- | --- | --- |
| 0-5 | uint8 each | Handle, activation, steps, algorithm, sensor mask, orientation mask |
| 6, 10, 14, 18, 22 | uint32 each | Algorithm parameters 1-5 |

Activation 0/1/2 means Inactive/Periodic/Burst. Algorithm 0 is SpectrumZoom.
The five raw values are exposed as `param1`-`param5`, together with their
interpretations: `upperFrequency` (Hz), `lowerFrequency` (Hz), `compressionType`,
`spectrumType`, and `cutOffFrequency` (Hz). Sensor and orientation fields are
combinable masks.

| Compression | Bands | Bits per band |
| --- | --- | --- |
| 0 | 50 | 8 |
| 1 | 50 | 16 |
| 2 | 100 | 8 |
| 3 | 100 | 16 |
| 4 | 200 | 8 |

Spectrum values 0-6 mean Undefined, RMS, Peak, Velocity RMS, Velocity Peak,
Envelope RMS, and Envelope Peak. Unknown mode, algorithm, activation,
compression, or spectrum values return errors. Reserved fields are preserved.

The basic codec reports extension settings but does not decode FFT samples.
The full-fledged codec uses a device's saved extension settings to decode FFT
samples under `data.extensionValues`. Each FFT vector carries its settings
handle in its final byte. The decoder checks that handle and the sample count
against the saved settings.

## Measurements

Scalar IDs decoded by these examples are 0 Battery level (encoding range
0-100 V), 1 Current loop (0-30 mA), and 14 Temperature (-273.15 to 2000 degrees
C). Encoding ranges describe the numeric conversion, not the operating limits
of a sensor or device. Reserved measurement IDs are not decoded.

The signature body contains 49 unsigned little-endian uint16 fields (98 bytes).
Fields 0-9 are vibration bands; fields 10-19 are the configurable spectrum,
named `custom_frequencyBandS10` through `custom_frequencyBandS19`. Fields 20-43
contain three sets of eight vibration indicators. Fields 44-47 are surface
temperature, `vibration_custom` (0-16 g), `sound_custom` (0-1), and sound RMS log
level. The final word is reserved and omitted from decoded measurements.
Signature values are returned under `data.signatureValues`.

## Example payloads and tests

`test/fixtures/sentinel_status.json` contains a synthetic status payload for
checking the decoder. Its boundary values are test data, not settings to send
to a device. Run `node --test test/sentinel_codec.test.js` to check decoding
locally with Node.js 18 or later.
