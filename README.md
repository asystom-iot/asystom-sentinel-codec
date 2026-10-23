# Asystom Sentinel LoRaWAN codec

This repository provides an example uplink decoder for Asystom Sentinel devices,
using the LoRaWAN Codec API Specification version 1.0.0 interface.

## Usage

Load `asystom_sentinel_codec.js` into your LoRaWAN Network Server's codec editor.
The `decodeUplink(input)` function takes the received payload in `input.bytes`,
the LoRaWAN port in `input.fPort`, and an optional reception time in
`input.recvTime`. It returns decoded `data`, an `errors` array, and a `warnings`
array.

See the [Sentinel protocol reference](doc/sentinel_protocol.md) for payload
layouts, units, and decoded output fields.

## Supported data

* Scalar measurements: battery level, current loop, and temperature.
* Vibration and configurable-spectrum signatures.
* System-status reports, including device settings and diagnostic information.

FFT zoom values require settings retained from earlier status reports and are
not decoded by this stateless codec. Split-frame helpers require the runtime to
preserve state between calls; standard LNS runtimes do not guarantee this.
For FFT zoom decoding and persistent per-device state, use the
`asystom-sentinel-full-fledged-codec` example.

Downlink encoding and decoding are not implemented.

## Tests

Run `node --test test/sentinel_codec.test.js` with Node.js 18 or later.
No additional dependencies or network access are required.

## LoRaWAN codec interface

See the [LoRaWAN Codec API Specification 1.0.0](https://resources.lora-alliance.org/technical-specifications/ts013-1-0-0-payload-codec-api)
for the standard codec interface.
