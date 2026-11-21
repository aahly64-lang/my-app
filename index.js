// The geofence background task must be defined before the app is registered.
import './src/geoTask';
import { I18nManager } from 'react-native';
import { registerRootComponent } from 'expo';
import App from './App';

// Hebrew app: always right-to-left.
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

registerRootComponent(App);
