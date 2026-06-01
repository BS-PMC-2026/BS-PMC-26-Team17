// app.config.js – dynamic wrapper over app.json
//
// Two things this handles that static JSON can't:
//
// 1. `android.googleServicesFile` is pointed at the GOOGLE_SERVICES_JSON
//    File env var when running on EAS Build. Locally we fall back to the
//    file sitting next to this config so `npx expo start` still works.
//
// 2. Dev builds get a SUFFIXED package (`com.tosafeplace.app.dev`) and a
//    "(Dev)" name so they can be installed alongside the preview/production
//    APK without Android treating one as an update of the other. EAS sets
//    `EAS_BUILD_PROFILE` automatically during builds; locally it's undefined
//    so we default to the production package.

module.exports = ({ config }) => {
  const isDevelopment = process.env.EAS_BUILD_PROFILE === 'development';

  const basePackage = config.android?.package ?? 'com.tosafeplace.app';
  const baseName = config.name ?? 'ToSafePlace';

  return {
    ...config,
    name: isDevelopment ? `${baseName} (Dev)` : baseName,
    android: {
      ...config.android,
      package: isDevelopment ? `${basePackage}.dev` : basePackage,
      googleServicesFile:
        process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    },
  };
};
