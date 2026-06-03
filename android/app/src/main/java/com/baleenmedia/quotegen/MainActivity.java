package com.baleenmedia.quotegen;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Force WebView text zoom to 100% for consistent PDF font rendering across all devices
        // This overrides system font size preferences to ensure PDFs match web browser output
        this.bridge.getWebView().getSettings().setTextZoom(100);
        
        // Register custom plugins
        registerPlugin(DownloadNotificationPlugin.class);
    }
}
