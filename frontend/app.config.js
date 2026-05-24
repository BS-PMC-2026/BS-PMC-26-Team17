// app.config.js – dynamic wrapper over app.json
//
// We need this for ONE thing: pointing `android.googleServicesFile` at the
// `GOOGLE_SERVICES_JSON` File env var on EAS Build, while still letting local
// dev use the literal file at ./google-services.json. Everything else is
// inherited from app.json so the team can keep editing config there.

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    // On EAS Build, `process.env.GOOGLE_SERVICES_JSON` resolves to the path of
    // the file uploaded as a File env var. Locally that env var is undefined,
    // so we fall back to the file sitting next to this config.
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
