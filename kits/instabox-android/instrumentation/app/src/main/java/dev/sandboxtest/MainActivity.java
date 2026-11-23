package dev.sandboxtest;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;

public class MainActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        Button button = new Button(this);
        button.setId(android.R.id.button1);
        button.setText("Count: 0");
        button.setOnClickListener(view -> button.setText("Count: 1"));
        setContentView(button);
    }
}
