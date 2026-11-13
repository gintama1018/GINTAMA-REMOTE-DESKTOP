package com.sonujangir.bridge;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import java.util.List;

public class ApprovalsAdapter extends RecyclerView.Adapter<ApprovalsAdapter.ViewHolder> {

    public interface OnApprovalActionListener {
        void onAllow(ApprovalItem item);
        void onDeny(ApprovalItem item);
    }

    private final List<ApprovalItem> items;
    private final OnApprovalActionListener listener;

    public ApprovalsAdapter(List<ApprovalItem> items, OnApprovalActionListener listener) {
        this.items = items;
        this.listener = listener;
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_approval, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        ApprovalItem item = items.get(position);
        holder.tvToolName.setText(item.tool != null ? item.tool : "tool_call");
        holder.tvRequestId.setText("ID: " + item.rid);
        holder.tvCommand.setText(item.command != null ? item.command : "(no command text)");
        holder.tvCwd.setText("CWD: " + (item.cwd != null && !item.cwd.isEmpty() ? item.cwd : "Default Workspace"));

        holder.btnAllow.setOnClickListener(v -> {
            if (listener != null) listener.onAllow(item);
        });

        holder.btnDeny.setOnClickListener(v -> {
            if (listener != null) listener.onDeny(item);
        });
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvToolName, tvRequestId, tvCommand, tvCwd;
        Button btnAllow, btnDeny;

        ViewHolder(View itemView) {
            super(itemView);
            tvToolName = itemView.findViewById(R.id.tvToolName);
            tvRequestId = itemView.findViewById(R.id.tvRequestId);
            tvCommand = itemView.findViewById(R.id.tvCommand);
            tvCwd = itemView.findViewById(R.id.tvCwd);
            btnAllow = itemView.findViewById(R.id.btnAllow);
            btnDeny = itemView.findViewById(R.id.btnDeny);
        }
    }
}

