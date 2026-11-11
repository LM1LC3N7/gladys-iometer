// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the IOmeterApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { IOmeterApp } from './src/app.js';
import { ACTIONS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new IOmeterApp({ gladys });

// --- Discovery -------------------------------------------------------------------
gladys.onScanRequest(() => app.scan());
// The device just created: its values are read now, not at the next tick.
gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
// Updated from Discovery: the new features get their values now.
gladys.onDeviceUpdated((device) => app.onDeviceUpdated(device));

// --- Configuration screen button ----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());
// The only way to take a consumption index held back (a save of the form never does).
gladys.onAction(ACTIONS.ACCEPT_HELD, () => app.acceptHeldIndex());

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated: restarting');
  return app.configUpdated(config);
});

// --- Connection lifecycle ------------------------------------------------------
// Every connection (the first one and each reconnection) reads the
// configuration (tried again without end when Gladys fails to give it), then
// publishes the device and every value again.
gladys.on('connected', () => {
  app.connected().catch((err) => logger.error('Start failed', err));
});
gladys.on('disconnected', () => {
  app.stop().catch((err) => logger.error('Stop failed', err));
});
gladys.handleShutdown(() => app.stop());

logger.info('Starting the IOmeter integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
