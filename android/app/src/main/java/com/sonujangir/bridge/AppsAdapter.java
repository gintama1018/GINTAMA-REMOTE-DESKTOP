package com.sonujangir.bridge;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;

public class AppsAdapter extends RecyclerView.Adapter<AppsAdapter.ViewHolder> {

    public interface OnAppActionListener {
        void onClose(AppItem item);
        void onForceKill(AppItem item);
    }

    private final List<AppItem> items;
    private final OnAppActionListener listener;

    public AppsAdapter(List<AppItem> items, OnAppActionListener listener) {
        this.items = items;
        this.listener = listener;
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_app, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        AppItem item = items.get(position);
        holder.tvAppName.setText(item.name + " (PID " + item.pid + ")");
        holder.tvAppTitle.setText(item.title != null && !item.title.isEmpty() ? item.title : "(Window with no title)");
        holder.tvAppMemory.setText(item.memoryMb + " MB");

        holder.btnCloseApp.setOnClickListener(v -> {
            if (listener != null) listener.onClose(item);
        });

        holder.btnForceKillApp.setOnClickListener(v -> {
            if (listener != null) listener.onForceKill(item);
        });
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvAppName, tvAppTitle, tvAppMemory;
        Button btnCloseApp, btnForceKillApp;

        ViewHolder(View itemView) {
            super(itemView);
            tvAppName = itemView.findViewById(R.id.tvAppName);
            tvAppTitle = itemView.findViewById(R.id.tvAppTitle);
            tvAppMemory = itemView.findViewById(R.id.tvAppMemory);
            btnCloseApp = itemView.findViewById(R.id.btnCloseApp);
            btnForceKillApp = itemView.findViewById(R.id.btnForceKillApp);
        }
    }
}

