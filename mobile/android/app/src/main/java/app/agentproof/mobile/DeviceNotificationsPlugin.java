package app.agentproof.mobile;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
@CapacitorPlugin(name="DeviceNotifications")
public class DeviceNotificationsPlugin extends Plugin {
 @PluginMethod public void displayAllowed(PluginCall call) {
  JSObject result=new JSObject();
  result.put("allowed",NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
  call.resolve(result);
 }
}
