# Bluetooth Printing Architecture

## The Constraint

Tallyko utilizes a React Native frontend built with Expo. During active development, we use **Expo Go** to preview the application on physical devices and simulators.

**Expo Go does not support native Bluetooth linking.** It is a sandboxed environment that only supports a curated list of native modules. Libraries like `react-native-bluetooth-classic` or `react-native-ble-plx` require custom native code, which means they fundamentally *cannot* work inside the standard Expo Go app.

## Current Implementation (Development Mode)

For development purposes, the `PrinterService.js` contains a mock that simulates connecting to a printer and printing a receipt by using `setTimeout` and outputting the receipt layout to `console.log`. This allows the UI flow to be built and tested without physical hardware or native builds.

## Production Implementation (Ejecting / Custom Dev Client)

To implement real Bluetooth printing in Production, you must leave the Expo Go sandbox. You have two options:

### 1. Expo Prebuild (EAS Build / Dev Client) - **Recommended**

Instead of ejecting completely, you can use Expo's Custom Dev Client approach. This allows you to retain Expo's managed workflow while injecting custom native code.

**Steps:**
1. Install the native library: `npx expo install react-native-ble-plx`
2. Install expo dev client: `npx expo install expo-dev-client`
3. Add the plugin to your `app.json` or `app.config.js`:
   ```json
   {
     "expo": {
       "plugins": ["react-native-ble-plx"]
     }
   }
   ```
4. Build the custom client using EAS: `eas build --profile development --platform android`
5. Install the resulting APK on your Android device and run `npx expo start --dev-client`.

### 2. Bare React Native App

If you require full control over the Android/iOS directories:
1. Run `npx expo prebuild`
2. Follow standard React Native CLI linking instructions for your chosen Bluetooth thermal printer library.

## Connecting to ESC/POS Thermal Printers

Once native Bluetooth is enabled, the logic in `PrinterService.js` should be replaced with ESC/POS commands sent over the Bluetooth serial connection to the paired thermal printer.
