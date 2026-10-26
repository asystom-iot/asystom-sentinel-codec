const assert = require('node:assert/strict');
const { sentinel_test: test, sentinel_trace_decoder } = require('./sentinel_trace');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the file exactly as an LNS loads it: no require, Buffer or module.
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'asystom_sentinel_codec.js'), 'utf8'), context);
const decoders = [{ name: 'standalone LNS',
    decode: sentinel_trace_decoder('standalone LNS', input => context.decodeUplink(input)) }];
const plain = value => JSON.parse(JSON.stringify(value));
const fixture = Buffer.from(require('./fixtures/sentinel_status.json').hex, 'hex');
const input = (bytes = fixture, fPort = 1, deveui = 'test-device') => ({
    bytes: Array.from(bytes), fPort, deveui, recvTime: '2026-10-23T00:00:00Z'
});

for (const decoder of decoders) {
    const decode = (...args) => decoder.decode(input(...args));
    test(`${decoder.name}: Sentinel status layout and unsigned limits`, () => {
        const result = decode();
        assert.deepEqual(plain(result.errors), []);
        assert.deepEqual(plain(result.warnings), []);
        const data = plain(result.data);
        assert.equal(data.firmwareVersion, 'v5.00');
        assert.deepEqual(data.firmwareStatus, {
            versionHealth: 3, mainRadiosVersionError: true, sensorVersionError: true,
            reservedVersionHealth: 0, radioStatus: 10, softwareStatus: 'LoRaWAN CM0 start failed',
            resetSources: 0x04f2,
            lastBootCauses: ['Low Voltage Detect Reset', 'Option Byte Loader Reset', 'Watchdog',
                'External Reset Pin', 'Power On Reset', 'Software - SYSRESETREQ bit'],
            reservedResetSources: 0
        });
        const schedule = data.schedulingSettings;
        assert.equal(schedule.activationMask, 0x8030690b);
        assert.equal(schedule.reservedActivationMask, 0x80000000);
        assert.deepEqual(schedule.activeIndicators, ['Battery level', 'Current loop', 'Magnet',
            'Wake-on event', 'Signature', 'Signature extension', 'Temperature', 'System check', 'Settings reader']);
        assert.equal(schedule.ambientPeriodicity, 655350);
        assert.equal(schedule.predictionPeriodicity, 327680);
        assert.equal(schedule.introspectionPeriodicity, 10);
        const advanced = data.advancedSettings;
        assert.deepEqual(advanced.sensorInformation.enumeration, ['InternalAccelerometer', 'ExternalAccelerometer',
            'InternalMicrophone', 'ExternalMicrophone', 'WeatherSensor', 'ShockDetection', 'RtdSensor', 'TcSensor']);
        assert.equal(advanced.sensorInformation.orientationMask, 7);
        assert.deepEqual(advanced.sensorInformation.orientation, ['XPreferred', 'YPreferred', 'ZPreferred']);
        assert.deepEqual(advanced.frequencies, { sonicFrequencyHigh: 655350, sonicFrequencyLow: 327680,
            vibrationFrequencyHigh: 32768, vibrationFrequencyLow: 1 });
        assert.deepEqual(advanced.rotationSpeedBoundaries, { rpmUpperBoundary: 3932100, rpmLowerBoundary: 1966080 });
        assert.equal(advanced.reserved0, 0xbeef);
        assert.equal(advanced.reserved1, 0xcafe);
        assert.equal(advanced.mileageThreshold, undefined);
        assert.equal(advanced.referenceCustomParam, undefined);
        assert.equal(advanced.customSpectrumType, 6);
        assert.equal(advanced.customSpectrumParam, 65535);
        assert.equal(advanced.woeBitmask, 'f5ffffff');
        assert.deepEqual(advanced.wakeOnEventInformation, {
            woeMode: 5, woeModeString: 'WoeContactTrig', woeFlag: true, woeParam: 2047,
            woeProfile: 3, woeProfileString: 'WoeHighPower', woeThreshold: 16383,
            woePretrigThreshold: 65535, woePostrigThreshold: 32768
        });
        assert.deepEqual(advanced.lorawanConfig, {
            adrIsEnabled: true, transmissionIsAcked: true, networkIsPrivate: true,
            lorawanCodingRateIsBase: true, codingRate: '4/8', dwellTimeIsOn: true,
            retransmitAckTwice: true, packetSplitIsEnabled: true, reserved: 511,
            specialFrequencySettings: 32768, linkCheckPeriod: 65535
        });
        const extension = data.extensionSettings;
        assert.equal(extension.handle, 254);
        assert.equal(extension.activation, 2);
        assert.equal(extension.steps, 255);
        assert.equal(extension.algorithm, 0);
        assert.equal(extension.sensorType, 255);
        assert.equal(extension.accelerometerOrientation, 7);
        assert.equal(extension.param1, 0xffffffff);
        assert.equal(extension.param2, 0x80000000);
        assert.equal(extension.param3, 3);
        assert.equal(extension.param4, 6);
        assert.equal(extension.param5, 0x12345678);
        assert.equal(extension.upperFrequency, extension.param1);
        assert.equal(extension.lowerFrequency, extension.param2);
        assert.equal(extension.compressionType, 3);
        assert.equal(extension.spectrumType, 6);
        assert.equal(extension.cutOffFrequency, 0x12345678);
    });

    test(`${decoder.name}: each sensor bit and full 24-bit orientation`, () => {
        const names = ['InternalAccelerometer', 'ExternalAccelerometer', 'InternalMicrophone',
            'ExternalMicrophone', 'WeatherSensor', 'ShockDetection', 'RtdSensor', 'TcSensor'];
        for (let bit = 0; bit < 8; ++bit) {
            const bytes = Buffer.from(fixture);
            bytes[20] = 1 << bit;
            bytes.set([5, 0x80, 0x12], 21);
            bytes[62] = 1 << bit;
            const result = decode(bytes);
            assert.deepEqual(plain(result.errors), []);
            assert.deepEqual(plain(result.data.advancedSettings.sensorInformation.enumeration), [names[bit]]);
            assert.equal(result.data.advancedSettings.sensorInformation.orientationMask, 0x128005);
            assert.deepEqual(plain(result.data.extensionSettings.sensors), [names[bit]]);
        }
        const bytes = Buffer.from(fixture);
        bytes.fill(0, 20, 24); bytes[62] = 0; bytes[63] = 0;
        const result = decode(bytes);
        assert.deepEqual(plain(result.errors), []);
        assert.deepEqual(plain(result.data.advancedSettings.sensorInformation.enumeration), ['NoSensor']);
        assert.deepEqual(plain(result.data.extensionSettings.orientations), ['NoOrientation']);
    });

    test(`${decoder.name}: every WOE mode and spectrum enum including undefined`, () => {
        for (let mode = 0; mode <= 5; ++mode) {
            const bytes = Buffer.from(fixture);
            bytes.fill(0, 44, 52); bytes[44] = mode;
            const result = decode(bytes);
            assert.deepEqual(plain(result.errors), []);
            assert.equal(result.data.advancedSettings.wakeOnEventInformation.woeMode, mode);
            assert.equal(result.data.advancedSettings.wakeOnEventInformation.woeFlag, false);
            assert.equal(result.data.advancedSettings.wakeOnEventInformation.woeThreshold, 0);
        }
        for (let type = 0; type <= 6; ++type) {
            const bytes = Buffer.from(fixture);
            bytes.writeUInt16LE(type, 40); bytes.writeUInt32LE(type, 76);
            assert.deepEqual(plain(decode(bytes).errors), []);
        }
    });

    test(`${decoder.name}: status bytes are independent, unknown bits remain raw`, () => {
        const bytes = Buffer.from(fixture);
        bytes.set([0x80, 11, 0, 1], 1);
        const result = decode(bytes);
        assert.deepEqual(plain(result.errors), []);
        const health = result.data.firmwareStatus;
        assert.equal(health.versionHealth, 128);
        assert.equal(health.mainRadiosVersionError, false);
        assert.equal(health.sensorVersionError, false);
        assert.equal(health.softwareStatus, 'LoRaWAN fatal error');
        assert.equal(health.reservedResetSources, 1);
        assert.deepEqual(plain(health.lastBootCauses), []);
        bytes[2] = 255;
        assert.equal(decode(bytes).data.firmwareStatus.softwareStatus, 'Unknown LoRaWAN status (255)');
    });

    test(`${decoder.name}: reject invalid status lengths while preserving scalar classification`, () => {
        for (let length = 1; length < fixture.length; ++length) {
            const result = decode(fixture.subarray(0, length));
            if (length === 3) {
                // FPort 1 and three bytes describe a scalar, even with ID 0xff.
                assert.deepEqual(plain(result.errors), []);
                assert.deepEqual(plain(result.warnings), ['Unidentified scalar value indicator (255)']);
            }
            else {
                assert.ok(result.errors.length > 0, `length ${length}`);
            }
            assert.equal(result.data.extensionSettings ?? undefined, undefined);
            assert.equal(result.data.advancedSettings, undefined);
        }
        assert.ok(decode(Buffer.concat([fixture, Buffer.from([0])])).errors.length > 0);
    });

    test(`${decoder.name}: reject unknown settings enum values`, () => {
        for (const [offset, value] of [[44, 15], [40, 7], [59, 3], [61, 1], [72, 5], [76, 7]]) {
            const bytes = Buffer.from(fixture); bytes[offset] = value;
            assert.ok(decode(bytes).errors.length > 0, `offset ${offset}`);
        }
    });

    test(`${decoder.name}: scalar plus status and caller input remains unchanged`, () => {
        const bytes = Buffer.concat([Buffer.from([14, 255, 255]), fixture]);
        const supplied = input(bytes, 2);
        const snapshot = JSON.stringify(supplied);
        const result = decoder.decode(supplied);
        assert.deepEqual(plain(result.errors), []);
        assert.equal(result.data.firmwareVersion, 'v5.00');
        assert.equal(result.data.scalarValues[0].getValue(), 2000);
        assert.equal(JSON.stringify(supplied), snapshot);
    });

    test(`${decoder.name}: unsupported ports and reserved scalar IDs`, () => {
        assert.match(decode(fixture, 67).errors[0], /frame length \(84 bytes\)/);
        const result = decode(Buffer.from([2, 0, 0]));
        assert.deepEqual(plain(result.data.scalarValues), []);
        assert.deepEqual(plain(result.warnings), ['Unidentified scalar value indicator (2)']);
    });

    test(`${decoder.name}: vector-valued scalar IDs do not change payload classification`, () => {
        for (const id of [0x0b, 0x0d, 0xff]) {
            for (let count = 1; count <= 3; ++count) {
                for (let position = 0; position < count; ++position) {
                    const bytes = Buffer.alloc(count * 3, 255);
                    for (let index = 0; index < count; ++index) bytes[index * 3] = 14;
                    bytes[position * 3] = id;
                    const result = decode(bytes, count);
                    assert.deepEqual(plain(result.errors), []);
                    assert.deepEqual(plain(result.warnings), [`Unidentified scalar value indicator (${id})`]);
                    assert.equal(result.data.scalarValues.length, count - 1);
                    for (const value of result.data.scalarValues) assert.equal(value.getValue(), 2000);
                    assert.equal(result.data.advancedSettings, undefined);
                    assert.equal(result.data.extensionSettings ?? undefined, undefined);
                    assert.equal(result.data.signatureValues?.length || 0, 0);
                    assert.equal(result.data.extensionValues?.length || 0, 0);
                }
            }
        }
    });

    test(`${decoder.name}: full Sentinel signature, custom spectrum and unsigned maxima`, () => {
        const bytes = Buffer.alloc(99, 255); bytes[0] = 11;
        const result = decode(bytes);
        assert.deepEqual(plain(result.errors), []);
        const values = result.data.signatureValues;
        assert.equal(values.length, 48); // 49 wire fields; reserved mileage omitted.
        assert.equal(values[20].value, 16);
        assert.equal(values[24].value, 30000);
        assert.equal(values[44].value, 2000);
        assert.equal(values[45].name, 'vibration_custom');
        assert.equal(values[45].value, 16);
        assert.equal(values[46].name, 'sound_custom');
        assert.equal(values[46].value, 1);
        assert.equal(values[47].value, 0);
        assert.match(values[10].name, /^custom_frequencyBand/);
        // Later frames must not mutate previously returned measurements.
        bytes.fill(0, 1); decode(bytes);
        assert.equal(values[20].value, 16);
        assert.ok(decode(bytes.subarray(0, 98)).errors.length > 0);
    });
}
