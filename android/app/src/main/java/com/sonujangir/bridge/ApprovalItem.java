package com.sonujangir.bridge;

public class ApprovalItem {
    public String rid;
    public String tool;
    public String command;
    public String cwd;
    public String workspace;
    public String conversation;
    public long remainingMs;

    public ApprovalItem(String rid, String tool, String command, String cwd, String workspace, String conversation, long remainingMs) {
        this.rid = rid;
        this.tool = tool;
        this.command = command;
        this.cwd = cwd;
        this.workspace = workspace;
        this.conversation = conversation;
        this.remainingMs = remainingMs;
    }
}

