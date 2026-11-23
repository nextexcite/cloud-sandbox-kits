package dev.sandboxtest;

import android.widget.Button;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

@RunWith(AndroidJUnit4.class)
public class CounterTest {
    @Test public void pressingCounterUpdatesItsLabel() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                Button button = activity.findViewById(android.R.id.button1);
                assertEquals("Count: 0", button.getText().toString());
                assertTrue(button.performClick());
                assertEquals("Count: 1", button.getText().toString());
            });
        }
    }

}
