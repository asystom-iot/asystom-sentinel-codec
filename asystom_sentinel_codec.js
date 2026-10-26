
/*
 #              ######               #                                                   ######                                               #####                                    #    ######  ###
 #        ####  #     #   ##        # #   #      #      #   ##   #    #  ####  ######    #     #   ##   #   # #       ####    ##   #####     #     #  ####  #####  ######  ####       # #   #     #  #
 #       #    # #     #  #  #      #   #  #      #      #  #  #  ##   # #    # #         #     #  #  #   # #  #      #    #  #  #  #    #    #       #    # #    # #      #    #     #   #  #     #  #
 #       #    # ######  #    #    #     # #      #      # #    # # #  # #      #####     ######  #    #   #   #      #    # #    # #    #    #       #    # #    # #####  #         #     # ######   #
 #       #    # #   #   ######    ####### #      #      # ###### #  # # #      #         #       ######   #   #      #    # ###### #    #    #       #    # #    # #      #         ####### #        #
 #       #    # #    #  #    #    #     # #      #      # #    # #   ## #    # #         #       #    #   #   #      #    # #    # #    #    #     # #    # #    # #      #    #    #     # #        #
 #######  ####  #     # #    #    #     # ###### ###### # #    # #    #  ####  ######    #       #    #   #   ######  ####  #    # #####      #####   ####  #####  ######  ####     #     # #       ###

 https://resources.lora-alliance.org/document/ts013-1-0-0-payload-codec-api
*/

/**
 * @typedef {Object} DecodedUplink
 * @property {Object} data - The open JavaScript object representing the decoded uplink payload when no errors occurred
 * @property {string[]} errors - A list of error messages while decoding the uplink payload
 * @property {string[]} warnings - A list of warning messages that do not prevent the driver from decoding the uplink payload
 */
// Size of a physical value for a scalar measurement
const SCALAR_VALUE_SIZE = 3;

// Size of a physical value for a vector element
const VECTOR_ELEMENT_VALUE_SIZE = 2;

const DB = "dB";
const MmPerSecond = "mm/s";
const G = "g";
const RPM = "rpm";

// Scalar value identifiers
const BATTERY_LEVEL_IDENTIFIER = 0x00;
const CURRENT_LOOP_IDENTIFIER = 0x01;
const TEMPERATURE_IDENTIFIER = 0x0e;

// Vector type identifiers
const SIGNATURE_VECTOR = 0x0b;
const SIGNATURE_EXTENSIONS = 0x0d;
const SYSTEM_STATUS_REPORT = 0xff;

const VECTOR_TYPES = [

    SIGNATURE_VECTOR,

    SIGNATURE_EXTENSIONS,
    SYSTEM_STATUS_REPORT
];


// State variable
let inputData;
let decodeResult;
let globalFrame;
let globalView;
let elementCount;
let _segmentedFrame = null;


// Sentinel wire values are always little endian, independent of the host.
const littleEndian = true;

// BEGIN SENTINEL SETTINGS
const sentinel_settings_layout = {
    statusHeader: 9, scheduling: 10, measurement: 32, radio: 6, extension: 26
};
const sentinel_sensor_bits = [
    [1, 'InternalAccelerometer'], [2, 'ExternalAccelerometer'],
    [4, 'InternalMicrophone'], [8, 'ExternalMicrophone'],
    [16, 'WeatherSensor'], [32, 'ShockDetection'], [64, 'RtdSensor'], [128, 'TcSensor']
];
const sentinel_orientation_bits = [[1, 'XPreferred'], [2, 'YPreferred'], [4, 'ZPreferred']];
const sentinel_indicators = {
    0: 'Battery level', 1: 'Current loop', 3: 'Magnet', 8: 'Wake-on event',
    11: 'Signature', 13: 'Signature extension', 14: 'Temperature',
    20: 'System check', 21: 'Settings reader'
};
const sentinel_woe_modes = [
    'WoeInactive', 'WoeMotionTrig', 'WoeMotionTrigAuto',
    'WoeSchedulerTrig', 'WoeAnalogTrig', 'WoeContactTrig'
];
const sentinel_woe_profiles = ['WoeLowPower', 'WoeMidPower1', 'WoeMidPower2', 'WoeHighPower'];
const sentinel_spectrum_types = [
    'UndefinedSpectrum', 'SpectrumRMS', 'SpectrumPeak', 'VelocitySpectrumRMS',
    'VelocitySpectrumPeak', 'EnvelopeSpectrumRMS', 'EnvelopeSpectrumPeak'
];
const sentinel_radio_status = [
    'LoRaWAN Ok', 'LoRaWAN unknown unsolicited reception', 'LoRaWAN invalid double data length',
    'LoRaWAN unknown transmission error', 'LoRaWAN pending transmission',
    'LoRaWAN link check failed', 'LoRaWAN consecutive unsolicited message missed',
    'LoRaWAN invalid parameter received', 'LoRaWAN modem wakeup failed',
    'LoRaWAN data rate too low', 'LoRaWAN CM0 start failed', 'LoRaWAN fatal error'
];

function sentinel_view(bytes, size, name) {
    if (bytes.length !== size) {
        throw new RangeError(`Invalid Sentinel ${name} length: expected ${size}, received ${bytes.length}`);
    }
    const array = Uint8Array.from(bytes);
    return new DataView(array.buffer);
}

function sentinel_hex(bytes) {
    return Array.from(bytes, byte => ('0' + byte.toString(16)).slice(-2)).join('');
}

function sentinel_mask_names(mask, bits, empty) {
    const names = bits.filter(entry => (mask & entry[0]) !== 0).map(entry => entry[1]);
    return names.length === 0 ? [empty] : names;
}

function sentinel_enum(value, names, field) {
    if (names[value] === undefined) {
        throw new RangeError(`Unknown Sentinel ${field} (${value})`);
    }
    return names[value];
}

function sentinel_decode_firmware_status(versionHealth, radioStatus, resetSources) {
    // Two separate status bytes are followed by a big-endian reset mask.
    // Version-health bits indicate compatibility errors, not flashing results.
    const resetBits = [
        [0x0002, 'Low Voltage Detect Reset'], [0x0010, 'Option Byte Loader Reset'],
        [0x0020, 'Watchdog'], [0x0040, 'External Reset Pin'],
        [0x0080, 'Power On Reset'], [0x0400, 'Software - SYSRESETREQ bit']
    ];
    return {
        versionHealth,
        mainRadiosVersionError: (versionHealth & 1) !== 0,
        sensorVersionError: (versionHealth & 2) !== 0,
        reservedVersionHealth: versionHealth & 0xfc,
        radioStatus,
        softwareStatus: sentinel_radio_status[radioStatus] || `Unknown LoRaWAN status (${radioStatus})`,
        resetSources,
        lastBootCauses: resetBits.filter(entry => (resetSources & entry[0]) !== 0).map(entry => entry[1]),
        reservedResetSources: resetSources & ~0x04f2
    };
}

function sentinel_decode_scheduling_settings(bytes) {
    const view = sentinel_view(bytes, sentinel_settings_layout.scheduling, 'scheduling settings');
    const mask = view.getUint32(0, true);
    const activeIndicators = Object.keys(sentinel_indicators)
        .filter(bit => (mask & (1 << Number(bit))) !== 0).map(bit => sentinel_indicators[bit]);
    const knownMask = Object.keys(sentinel_indicators).reduce((result, bit) => result | (1 << Number(bit)), 0);
    return {
        activationBitmask: sentinel_hex(bytes.slice(0, 4)),
        activationMask: mask,
        activeIndicators,
        reservedActivationMask: (mask & ~knownMask) >>> 0,
        // Scheduling periods use 10 seconds per LSB.
        ambientPeriodicity: view.getUint16(4, true) * 10,
        predictionPeriodicity: view.getUint16(6, true) * 10,
        introspectionPeriodicity: view.getUint16(8, true) * 10
    };
}

function sentinel_decode_advanced_settings(bytes) {
    const view = sentinel_view(bytes, sentinel_settings_layout.measurement + sentinel_settings_layout.radio, 'advanced settings');
    const sensorMask = view.getUint8(0);
    const orientationMask = view.getUint32(0, true) >>> 8;
    const woe = view.getUint32(24, true);
    const mode = woe & 15;
    const profile = (woe >>> 16) & 3;
    const flags = view.getUint16(32, true);
    const spectrumType = view.getUint16(20, true);
    return {
        sensorInformationBitmask: sentinel_hex(bytes.slice(0, 4)),
        sensorInformation: {
            mask: sensorMask,
            enumeration: sentinel_mask_names(sensorMask, sentinel_sensor_bits, 'NoSensor'),
            orientationMask,
            orientation: sentinel_mask_names(orientationMask, sentinel_orientation_bits, 'NoOrientation'),
            reservedOrientationMask: orientationMask & ~7
        },
        frequencies: {
            sonicFrequencyHigh: view.getUint16(4, true) * 10,
            sonicFrequencyLow: view.getUint16(6, true) * 10,
            vibrationFrequencyHigh: view.getUint16(8, true),
            vibrationFrequencyLow: view.getUint16(10, true)
        },
        rotationSpeedBoundaries: {
            rpmUpperBoundary: view.getUint16(12, true) * 60,
            rpmLowerBoundary: view.getUint16(14, true) * 60
        },
        reserved0: view.getUint16(16, true),
        reserved1: view.getUint16(18, true),
        customSpectrumType: spectrumType,
        customSpectrumTypeString: sentinel_enum(spectrumType, sentinel_spectrum_types, 'custom spectrum type'),
        customSpectrumParam: view.getUint16(22, true),
        woeBitmask: sentinel_hex(bytes.slice(24, 28)),
        wakeOnEventInformation: {
            woeMode: mode,
            woeModeString: sentinel_enum(mode, sentinel_woe_modes, 'Wake-On-Event mode'),
            woeFlag: (woe & 16) !== 0,
            woeParam: (woe >>> 5) & 0x7ff,
            woeProfile: profile,
            woeProfileString: sentinel_woe_profiles[profile],
            woeThreshold: woe >>> 18,
            woePretrigThreshold: view.getUint16(28, true),
            woePostrigThreshold: view.getUint16(30, true)
        },
        lorawanConfig: {
            adrIsEnabled: (flags & 1) !== 0,
            transmissionIsAcked: (flags & 2) !== 0,
            networkIsPrivate: (flags & 4) !== 0,
            lorawanCodingRateIsBase: (flags & 8) !== 0,
            codingRate: (flags & 8) !== 0 ? '4/8' : '4/5',
            dwellTimeIsOn: (flags & 16) !== 0,
            retransmitAckTwice: (flags & 32) !== 0,
            packetSplitIsEnabled: (flags & 64) !== 0,
            reserved: flags >>> 7,
            specialFrequencySettings: view.getUint16(34, true),
            linkCheckPeriod: view.getUint16(36, true)
        }
    };
}

function sentinel_decode_extension_settings(bytes) {
    const view = sentinel_view(bytes, sentinel_settings_layout.extension, 'extension settings');
    const settings = {
        handle: view.getUint8(0), activation: view.getUint8(1), steps: view.getUint8(2),
        algorithm: view.getUint8(3), sensorType: view.getUint8(4),
        accelerometerOrientation: view.getUint8(5),
        param1: view.getUint32(6, true), param2: view.getUint32(10, true),
        param3: view.getUint32(14, true), param4: view.getUint32(18, true),
        param5: view.getUint32(22, true)
    };
    settings.activationString = sentinel_enum(settings.activation, ['Inactive', 'Periodic', 'Burst'], 'extension activation');
    sentinel_enum(settings.algorithm, ['SpectrumZoom'], 'extension algorithm');
    settings.sensors = sentinel_mask_names(settings.sensorType, sentinel_sensor_bits, 'NoSensor');
    settings.orientations = sentinel_mask_names(settings.accelerometerOrientation, sentinel_orientation_bits, 'NoOrientation');
    settings.reservedOrientationMask = settings.accelerometerOrientation & ~7;
    // Spectrum-zoom parameters: frequency limits, compression, type and cutoff.
    settings.upperFrequency = settings.param1;
    settings.lowerFrequency = settings.param2;
    settings.compressionType = settings.param3;
    sentinel_enum(settings.compressionType, [0, 1, 2, 3, 4], 'FFT zoom compression');
    settings.spectrumType = settings.param4;
    settings.spectrumTypeString = sentinel_enum(settings.spectrumType, sentinel_spectrum_types, 'extension spectrum type');
    settings.cutOffFrequency = settings.param5;
    return settings;
}

function sentinel_decode_system_status(bytes) {
    const size = sentinel_settings_layout.statusHeader + sentinel_settings_layout.scheduling +
        sentinel_settings_layout.measurement + sentinel_settings_layout.radio + sentinel_settings_layout.extension;
    const view = sentinel_view(bytes, size, 'system status');
    const schedulingOffset = sentinel_settings_layout.statusHeader;
    const advancedOffset = schedulingOffset + sentinel_settings_layout.scheduling;
    const extensionOffset = advancedOffset + sentinel_settings_layout.measurement + sentinel_settings_layout.radio;
    const schedulingSettings = sentinel_decode_scheduling_settings(bytes.slice(schedulingOffset, advancedOffset));
    return {
        firmwareStatus: sentinel_decode_firmware_status(view.getUint8(0), view.getUint8(1), view.getUint16(2, false)),
        firmwareVersion: String.fromCharCode(...bytes.slice(4, 9)),
        schedulingSettings,
        activationStatus: schedulingSettings.activeIndicators.map(name => `${name} scheduling is active`),
        advancedSettings: sentinel_decode_advanced_settings(bytes.slice(advancedOffset, extensionOffset)),
        extensionSettings: sentinel_decode_extension_settings(bytes.slice(extensionOffset))
    };
}

function sentinel_decode_cached_extension_settings(cached) {
    // Revalidate persisted values using the same wire parser as a fresh status.
    const fields = ['handle', 'activation', 'steps', 'algorithm', 'sensorType',
        'accelerometerOrientation', 'param1', 'param2', 'param3', 'param4', 'param5'];
    const bytes = new Uint8Array(sentinel_settings_layout.extension);
    const view = new DataView(bytes.buffer);
    fields.forEach((field, index) => {
        const value = cached[field];
        const max = index < 6 ? 255 : 0xffffffff;
        if (!Number.isInteger(value) || value < 0 || value > max) {
            throw new RangeError(`Invalid Sentinel cached extension field ${field}`);
        }
        if (index < 6) view.setUint8(index, value);
        else view.setUint32(6 + (index - 6) * 4, value, true);
    });
    return sentinel_decode_extension_settings(bytes);
}
// END SENTINEL SETTINGS

// A class to represent the physical values extracted from Sentinel data frames
class PhysicalValue {

    // Signature physical values are identified by their index in this array
    static signaturePhysicalValues = [
        { name: "vibration_frequencyBandS0", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "vibration_frequencyBandS1", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "vibration_frequencyBandS2", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "vibration_frequencyBandS3", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "vibration_frequencyBandS4", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "vibration_frequencyBandS5", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "vibration_frequencyBandS6", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "vibration_frequencyBandS7", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "vibration_frequencyBandS8", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "vibration_frequencyBandS9", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "custom_frequencyBandS10", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "custom_frequencyBandS11", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "custom_frequencyBandS12", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "custom_frequencyBandS13", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "custom_frequencyBandS14", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "custom_frequencyBandS15", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "custom_frequencyBandS16", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "custom_frequencyBandS17", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "custom_frequencyBandS18", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "custom_frequencyBandS19", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "acceleration_x", unit: G, value: 0.0, min: 0.0, max: 16.0 },
        { name: "velocity_x", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "acceleration_x_peak", unit: G, value: 0.0, min: 0.0, max: 16.0 },
        { name: "kurtosis_x", unit: "", value: 0.0, min: 0.0, max: 100.0 },
        { name: "vibration_x_root", unit: RPM, value: 0.0, min: 0.0, max: 30000.0 },
        { name: "velocity_x_f1", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "velocity_x_f2", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "velocity_x_f3", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "acceleration_y", unit: G, value: 0.0, min: 0.0, max: 16.0 },
        { name: "velocity_y", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "acceleration_y_peak", unit: G, value: 0.0, min: 0.0, max: 16.0 },
        { name: "kurtosis_y", unit: "", value: 0.0, min: 0.0, max: 100.0 },
        { name: "vibration_y_root", unit: RPM, value: 0.0, min: 0.0, max: 30000.0 },
        { name: "velocity_y_f1", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "velocity_y_f2", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "velocity_y_f3", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "acceleration_z", unit: G, value: 0.0, min: 0.0, max: 16.0 },
        { name: "velocity_z", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "acceleration_z_peak", unit: G, value: 0.0, min: 0.0, max: 16.0 },
        { name: "kurtosis_z", unit: "", value: 0.0, min: 0.0, max: 100.0 },
        { name: "vibration_z_root", unit: RPM, value: 0.0, min: 0.0, max: 30000.0 },
        { name: "velocity_z_f1", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "velocity_z_f2", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "velocity_z_f3", unit: MmPerSecond, value: 0.0, min: 0.0, max: 100.0 },
        { name: "temperature_machineSurface", unit: "°C", value: 0.0, min: -273.15, max: 2000.0 },
        { name: "vibration_custom", unit: G, value: 0.0, min: 0.0, max: 16.0 },
        { name: "sound_custom", unit: "", value: 0.0, min: 0.0, max: 1.0 },
        { name: "sound_sonicRmslog", unit: DB, value: 0.0, min: -150.0, max: 0.0 },
        { name: "", unit: "", value: 0.0, min: 0.0, max: 65535.0 }
    ];

    constructor(name, unit, value) {
        this._name = name;
        this._unit = unit;
        this._value = value;
    }

    getName() {
        return this._name;
    }

    getUnit() {
        return this._unit;
    }

    getValue() {
        return this._value;
    }
}


const CRC_CCITT_TABLE = [
    0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50A5, 0x60C6, 0x70E7,
    0x8108, 0x9129, 0xA14A, 0xB16B, 0xC18C, 0xD1AD, 0xE1CE, 0xF1EF,
    0x1231, 0x0210, 0x3273, 0x2252, 0x52B5, 0x4294, 0x72F7, 0x62D6,
    0x9339, 0x8318, 0xB37B, 0xA35A, 0xD3BD, 0xC39C, 0xF3FF, 0xE3DE,
    0x2462, 0x3443, 0x0420, 0x1401, 0x64E6, 0x74C7, 0x44A4, 0x5485,
    0xA56A, 0xB54B, 0x8528, 0x9509, 0xE5EE, 0xF5CF, 0xC5AC, 0xD58D,
    0x3653, 0x2672, 0x1611, 0x0630, 0x76D7, 0x66F6, 0x5695, 0x46B4,
    0xB75B, 0xA77A, 0x9719, 0x8738, 0xF7DF, 0xE7FE, 0xD79D, 0xC7BC,
    0x48C4, 0x58E5, 0x6886, 0x78A7, 0x0840, 0x1861, 0x2802, 0x3823,
    0xC9CC, 0xD9ED, 0xE98E, 0xF9AF, 0x8948, 0x9969, 0xA90A, 0xB92B,
    0x5AF5, 0x4AD4, 0x7AB7, 0x6A96, 0x1A71, 0x0A50, 0x3A33, 0x2A12,
    0xDBFD, 0xCBDC, 0xFBBF, 0xEB9E, 0x9B79, 0x8B58, 0xBB3B, 0xAB1A,
    0x6CA6, 0x7C87, 0x4CE4, 0x5CC5, 0x2C22, 0x3C03, 0x0C60, 0x1C41,
    0xEDAE, 0xFD8F, 0xCDEC, 0xDDCD, 0xAD2A, 0xBD0B, 0x8D68, 0x9D49,
    0x7E97, 0x6EB6, 0x5ED5, 0x4EF4, 0x3E13, 0x2E32, 0x1E51, 0x0E70,
    0xFF9F, 0xEFBE, 0xDFDD, 0xCFFC, 0xBF1B, 0xAF3A, 0x9F59, 0x8F78,
    0x9188, 0x81A9, 0xB1CA, 0xA1EB, 0xD10C, 0xC12D, 0xF14E, 0xE16F,
    0x1080, 0x00A1, 0x30C2, 0x20E3, 0x5004, 0x4025, 0x7046, 0x6067,
    0x83B9, 0x9398, 0xA3FB, 0xB3DA, 0xC33D, 0xD31C, 0xE37F, 0xF35E,
    0x02B1, 0x1290, 0x22F3, 0x32D2, 0x4235, 0x5214, 0x6277, 0x7256,
    0xB5EA, 0xA5CB, 0x95A8, 0x8589, 0xF56E, 0xE54F, 0xD52C, 0xC50D,
    0x34E2, 0x24C3, 0x14A0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
    0xA7DB, 0xB7FA, 0x8799, 0x97B8, 0xE75F, 0xF77E, 0xC71D, 0xD73C,
    0x26D3, 0x36F2, 0x0691, 0x16B0, 0x6657, 0x7676, 0x4615, 0x5634,
    0xD94C, 0xC96D, 0xF90E, 0xE92F, 0x99C8, 0x89E9, 0xB98A, 0xA9AB,
    0x5844, 0x4865, 0x7806, 0x6827, 0x18C0, 0x08E1, 0x3882, 0x28A3,
    0xCB7D, 0xDB5C, 0xEB3F, 0xFB1E, 0x8BF9, 0x9BD8, 0xABBB, 0xBB9A,
    0x4A75, 0x5A54, 0x6A37, 0x7A16, 0x0AF1, 0x1AD0, 0x2AB3, 0x3A92,
    0xFD2E, 0xED0F, 0xDD6C, 0xCD4D, 0xBDAA, 0xAD8B, 0x9DE8, 0x8DC9,
    0x7C26, 0x6C07, 0x5C64, 0x4C45, 0x3CA2, 0x2C83, 0x1CE0, 0x0CC1,
    0xEF1F, 0xFF3E, 0xCF5D, 0xDF7C, 0xAF9B, 0xBFBA, 0x8FD9, 0x9FF8,
    0x6E17, 0x7E36, 0x4E55, 0x5E74, 0x2E93, 0x3EB2, 0x0ED1, 0x1EF0
];


// A representation of a segmented frame
class SegmentedFrame {

    constructor(frameChunk) {
        this._currentPayload = frameChunk;
        this._expectedLength = frameChunk[0];
        this._nbOfElements = frameChunk[1];
    }

    getCurrentPayload() {
        return this._currentPayload;
    }

    addPayloadChunk(frameChunk) {
        if (frameChunk.length > 0) {
            const temporary = this._currentPayload;
            this._currentPayload = new Uint8Array(temporary.length + frameChunk.length);
            this._currentPayload.set(temporary);
            this._currentPayload.set(frameChunk, temporary.length);
        }
    }

    // Checks whether all segments of a frame have been received
    isComplete() {
        return this._currentPayload.byteLength === this._expectedLength;
    }

    getLength() {
        return this._currentPayload.length - 4;
    }

    getNbElements() {
        return this._nbOfElements;
    }

    // The useful part of a reconstructed frame start 2 bytes after the frame start
    // (as these bytes contain the whole size and the number of elements) and stops
    // 2 bytes before the frame end (these 2 last bytes contain the CRC)
    getUsefulPayload() {
        return this._currentPayload.slice(2, this._currentPayload.length - 2);
    }

    // Check that the reconstructed frame is valid, i.e. there was no transmission problem
    checkCrc() {
        let inputArray = this._currentPayload;
        let crc = 0xFFFF; // initial value for ccitt_false
        let u16mask = 0xFFFF;
        let u8mask = 0xFF;

        for (let i = 0; i < inputArray.byteLength; i++) {
            let currentByte = inputArray[i] & u8mask;
            crc = (crc ^ (currentByte << 8)) & u16mask;
            let tableIndex = (crc >> 8) & u8mask;
            crc = (crc << 8) & u16mask;
            crc = (crc ^ CRC_CCITT_TABLE[tableIndex]) & u16mask;
        }

        return crc === 0;
    }
}


// Convert a byte array into an ArrayBuffer
// Used to get integer values from a byte array, taking into account endianess
function byteArrayToUint8Array(byteArray) {
    let uint8Array = new Uint8Array(byteArray.length);
    uint8Array.set(byteArray);
    return uint8Array;
}


// The status vector excludes its 0xff identifier.
function extractSystemStatusData(vector) {
    try {
        Object.assign(decodeResult.data, sentinel_decode_system_status(vector));
    }
    catch (error) {
        decodeResult.errors.push(error.message);
    }
}


// Process a vector in the data frame
// The "vector" argument points to the first byte following the "vectorType" argument, which represents the type of vector
function processVectorContent(vector, vectorType, nbElements, vectorView) {

    // Case where the vector type is unknown
    if (VECTOR_TYPES.includes(vectorType) === false) {
        decodeResult.errors.push(`Unknown vector type (${vectorType})`);
        return;
    }

    switch(vectorType) {

        case SIGNATURE_VECTOR:
            decodeResult.data.signatureValues = extractSignatureValues(vectorView, nbElements);
            break;


        case SIGNATURE_EXTENSIONS:
            decodeResult.warnings.push(`Extension frames are not yet supported`);
            break;

        case SYSTEM_STATUS_REPORT:
            extractSystemStatusData(vector, vectorView);
            break;

        default:
            // Should not occur (except if modified in another thread - ok, forget it !)
            break;
    }
}


function buf2hex(buffer) { // buffer is an ArrayBuffer
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}


// Extract physical values from a signature vector
// The input vector argument is a Buffer
function extractSignatureValues(vectorView, nbElements) {
    let signatureValues = [];
    if (vectorView.byteLength !== PhysicalValue.signaturePhysicalValues.length * VECTOR_ELEMENT_VALUE_SIZE) {
        decodeResult.errors.push('Invalid Sentinel signature length (expected 98 bytes)');
        return signatureValues;
    }

    for (let frameIndex = 0, measurementIndex = 0; frameIndex < nbElements*VECTOR_ELEMENT_VALUE_SIZE; frameIndex += VECTOR_ELEMENT_VALUE_SIZE, ++measurementIndex) {

        // Check whether architecture is little endian or not
        let valueInFrame = vectorView.getUint16(frameIndex, littleEndian);
        let scale = 65535;
        let physicalValue;

        // Skip values that are not useful anymore
        if (PhysicalValue.signaturePhysicalValues[measurementIndex].name === "") {
            continue;
        }

        physicalValue = valueInFrame * (PhysicalValue.signaturePhysicalValues[measurementIndex].max - PhysicalValue.signaturePhysicalValues[measurementIndex].min) / scale + PhysicalValue.signaturePhysicalValues[measurementIndex].min;

        let valueItem = { ...PhysicalValue.signaturePhysicalValues[measurementIndex] };
        valueItem.value = physicalValue;

        signatureValues.push(valueItem);
    }

    return signatureValues;
}


// This method extracts scalar values from the frame.
function extractScalarValues(nbScalars) {
    let scalarValues = [];
    let unit = "";
    let name = "";
    let valueInFrame;

    for (let i = 0; i < nbScalars * SCALAR_VALUE_SIZE; i += SCALAR_VALUE_SIZE) {
        valueInFrame = globalView.getUint16(i+1, littleEndian);

        let min = 0.0, max = 100.0;
        let scale = 65535;
        let physicalValue;

        let valueToCompute = true;

        switch (inputData.bytes[i]) {
            case BATTERY_LEVEL_IDENTIFIER:
                name = "Battery level";
                unit = "Volt";
                break;
            case CURRENT_LOOP_IDENTIFIER:
                name = "Current loop";
                unit = "mA";
                min = 0;        
                max = 30;
                break;
            case TEMPERATURE_IDENTIFIER:
                name = "Ambient temperature";
                unit = "°C";
                min = -273.15;
                max = 2000;
                break;
            default:
                decodeResult.warnings.push(`Unidentified scalar value indicator (${globalFrame[i]})`);
                valueToCompute = false;
                break;
        }

        if (valueToCompute) {
            physicalValue = valueInFrame * (max - min) / scale + min;
            let valueItem = new PhysicalValue(name, unit, physicalValue);
            scalarValues.push(valueItem);
        }
    }

    decodeResult.data.scalarValues = scalarValues;
}

/**
 * Decode uplink
 * @param {Object} input - An object provided by the IoT Flow framework
 * @param {number[]} input.bytes - Array of bytes represented as numbers as it has been sent from the device
 * @param {number} input.fPort - The Port Field on which the uplink has been sent
 * @param {Date} input.recvTime - The uplink message time recorded by the LoRaWAN network server
 * @returns {DecodedUplink} The decoded object
 */
function decodeUplink(input) {
    input = { ...input, bytes: Array.from(input.bytes) };
    // Prepare function output
    decodeResult = {
        data: {
            timeStamp: input.recvTime
        },
        errors: [],
        warnings: [],
    };

    // Case where data seem corrupted
    if (input.fPort > 105) {
        decodeResult.errors.push(`Invalid number of elements in frame (${input.fPort})`);
        return decodeResult;
    }

    // Case of the first chunk of a segmented frame
    if (input.fPort === 100) {
        _segmentedFrame = new SegmentedFrame(input.bytes);
        decodeResult.warnings.push("First frame of a segmented data frame; additional data frames are needed");
        return decodeResult;
    }

    // Case of an intermediary or final segmented frame chunk
    if ((input.fPort > 100) && (input.fPort < 105)) {
        if (_segmentedFrame === null) {
            decodeResult.warnings.push("This is a following chunk of a segmented frame, but the first one has been lost");
            return decodeResult;
        }

        _segmentedFrame.addPayloadChunk(input.bytes);

        // Not the final chunk --> current frame chunk fully processed
        if (! _segmentedFrame.isComplete()) {
            decodeResult.warnings.push("Complementary frame of a segmented data frame; additional data frames are needed");
            return decodeResult;
        }

        // Final chunk received --> prepare further processing
        if (_segmentedFrame.checkCrc()) {
            input.bytes = _segmentedFrame.getUsefulPayload();
            input.fPort = _segmentedFrame.getNbElements();
            _segmentedFrame = null;
        }

        // Case where there was a problem during transmission
        else {
            decodeResult.errors.push("Frame segmentation problem (CRC check failed)");
            return decodeResult;
        }
    }

    inputData = input;
    globalFrame = byteArrayToUint8Array(inputData.bytes);
    globalView = new DataView(globalFrame.buffer);
    elementCount = inputData.fPort;

    let nbScalars;
    let vectorInFrame = false;

    // Classify by length before interpreting IDs: a corrupted scalar ID can match a vector ID.
    if (inputData.bytes.length === (elementCount * SCALAR_VALUE_SIZE)) {
        nbScalars = elementCount;
    }

    // Possible error case
    else {
        if (inputData.bytes.length < (elementCount * SCALAR_VALUE_SIZE)) {
            decodeResult.errors.push(`Inconsistent number of elements in frame (${elementCount}) and frame length (${inputData.bytes.length} bytes)`);
            return decodeResult;
        }

        // There is a vector and possibly some scalars
        else {
            nbScalars = elementCount - 1;
            vectorInFrame = true;
        }
    }

    // Extract scalar values from frame
    if (nbScalars > 0) {
        extractScalarValues(nbScalars);
    }

    // Extract vector content
    if (vectorInFrame) {
        let vectorStart = nbScalars * SCALAR_VALUE_SIZE + 1;
        let vector = inputData.bytes.slice(vectorStart);
        let vectorType = inputData.bytes[nbScalars*SCALAR_VALUE_SIZE];
        let nbElements = vector.length / VECTOR_ELEMENT_VALUE_SIZE;
        let uint8Array = new Uint8Array(vector.length);
        uint8Array.set(vector);
        let vectorView = new DataView(uint8Array.buffer);

        processVectorContent(vector, vectorType, nbElements, vectorView);
    }

    return decodeResult;
}

/**
 * @typedef {Object} EncodedDownlink
 * @property {number[]} bytes - Array of bytes represented as numbers as it will be sent to the device
 * @property {number} fPort - The Port Field on which the downlink must be sent
 * @property {string[]} errors - A list of error messages while encoding the downlink object
 * @property {string[]} warnings - A list of warning messages that do not prevent the driver from encoding the downlink object
 */

/**
 * Downlink encode
 * @param {Object} input - An object provided by the IoT Flow framework
 * @param {Object} input.data - The higher-level object representing your downlink
 * @returns {EncodedDownlink} The encoded object
 */
function encodeDownlink(input) {
    let output = {
        fPort: undefined,
        bytes: undefined,
        errors: "Not yet implemented"
    };
    return output;
}


/**
 * @typedef {Object} DecodedDownlink
 * @property {Object} data - The open JavaScript object representing the decoded downlink payload when no errors occurred
 * @property {string[]} errors - A list of error messages while decoding the downlink payload
 * @property {string[]} warnings - A list of warning messages that do not prevent the driver from decoding the downlink payload
 */

/**
 * Downlink decode
 * @param {Object} input - An object provided by the IoT Flow framework
 * @param {number[]} input.bytes - Array of bytes represented as numbers as it will be sent to the device
 * @param {number} input.fPort - The Port Field on which the downlink must be sent
 * @param {Date} input.recvTime - The uplink message time computed by the IoT Flow framework
 * @returns {DecodedDownlink} The decoded object
 */
function decodeDownlink(input) {
    let output = {
        data: undefined,
        errors: "Not yet implemented"
    };
    return output;
}
