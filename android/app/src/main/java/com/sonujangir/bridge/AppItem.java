package com.sonujangir.bridge;

public class AppItem {
    public int pid;
    public String name;
    public String title;
    public int memoryMb;
    public boolean responding;

    public AppItem(int pid, String name, String title, int memoryMb, boolean responding) {
        this.pid = pid;
        this.name = name;
        this.title = title;
        this.memoryMb = memoryMb;
        this.responding = responding;
    }
}

