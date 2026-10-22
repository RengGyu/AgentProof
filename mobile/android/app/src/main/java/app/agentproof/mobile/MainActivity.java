package app.agentproof.mobile;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle state) {
  registerPlugin(DeviceNotificationsPlugin.class);
  super.onCreate(state);
 }
}
