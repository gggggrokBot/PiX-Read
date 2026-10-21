import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pixread.app",
  appName: "PiX-Read",
  webDir: "dist/renderer",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#f3f6f9",
  },
  plugins: {
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#f3f6f9",
    },
  },
};

export default config;
