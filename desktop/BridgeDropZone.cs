using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace BridgeRemote
{
    public class DropZoneForm : Form
    {
        // UI Controls
        private Panel headerPanel;
        private Label titleLabel;
        private Label statusDot;
        private Label statusLabel;
        private Button btnPin;
        private Button btnMin;
        private Button btnClose;

        private Panel dropTargetPanel;
        private Label dropIconLabel;
        private Label dropMainLabel;
        private Label dropSubLabel;
        private ProgressBar progressBar;
        private LinkLabel browseLink;

        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private System.Windows.Forms.Timer statusTimer;

        // State
        private bool isPinned = true;
        private bool isDraggingWindow = false;
        private Point dragStartPoint;
        private bool isSending = false;

        // Styling Colors
        private Color colBg = Color.FromArgb(15, 23, 42);          // Slate 900
        private Color colCard = Color.FromArgb(30, 41, 59);        // Slate 800
        private Color colBorder = Color.FromArgb(51, 65, 85);       // Slate 700
        private Color colCyan = Color.FromArgb(56, 189, 248);       // Sky 400
        private Color colGreen = Color.FromArgb(34, 197, 94);       // Emerald 500
        private Color colRed = Color.FromArgb(239, 68, 68);         // Red 500
        private Color colTextMuted = Color.FromArgb(148, 163, 184); // Slate 400

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new DropZoneForm());
        }

        public DropZoneForm()
        {
            InitializeComponent();
            CheckPhoneStatus();
        }

        private void InitializeComponent()
        {
            this.Text = "Bridge Remote - POCO M6 Pro 5G Drop Zone";
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.Manual;
            this.Size = new Size(330, 200);
            this.BackColor = colBg;
            this.TopMost = isPinned;
            this.ShowInTaskbar = false;
            this.AllowDrop = true;

            // Position at bottom-right above taskbar
            Rectangle workArea = Screen.PrimaryScreen.WorkingArea;
            this.Location = new Point(workArea.Right - this.Width - 24, workArea.Bottom - this.Height - 24);

            // 1. Header Panel
            headerPanel = new Panel();
            headerPanel.Dock = DockStyle.Top;
            headerPanel.Height = 38;
            headerPanel.BackColor = Color.FromArgb(20, 29, 47);
            headerPanel.MouseDown += OnHeaderMouseDown;
            headerPanel.MouseMove += OnHeaderMouseMove;
            headerPanel.MouseUp += OnHeaderMouseUp;

            // Phone Icon & Title
            titleLabel = new Label();
            titleLabel.Text = "📱 POCO M6 Pro 5G";
            titleLabel.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            titleLabel.ForeColor = Color.White;
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(10, 10);
            titleLabel.MouseDown += OnHeaderMouseDown;
            titleLabel.MouseMove += OnHeaderMouseMove;
            titleLabel.MouseUp += OnHeaderMouseUp;
            headerPanel.Controls.Add(titleLabel);

            // Status Dot
            statusDot = new Label();
            statusDot.Text = "●";
            statusDot.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            statusDot.ForeColor = colGreen;
            statusDot.AutoSize = true;
            statusDot.Location = new Point(160, 8);
            headerPanel.Controls.Add(statusDot);

            // Status Text
            statusLabel = new Label();
            statusLabel.Text = "Connecting...";
            statusLabel.Font = new Font("Segoe UI", 8.0f);
            statusLabel.ForeColor = colTextMuted;
            statusLabel.AutoSize = true;
            statusLabel.Location = new Point(175, 12);
            headerPanel.Controls.Add(statusLabel);

            // Window Action Buttons
            btnPin = CreateHeaderButton("📌", 235);
            btnPin.Click += (s, e) => {
                isPinned = !isPinned;
                this.TopMost = isPinned;
                btnPin.ForeColor = isPinned ? colCyan : colTextMuted;
            };
            btnPin.ForeColor = colCyan;
            headerPanel.Controls.Add(btnPin);

            btnMin = CreateHeaderButton("—", 265);
            btnMin.Click += (s, e) => { this.Hide(); };
            headerPanel.Controls.Add(btnMin);

            btnClose = CreateHeaderButton("✕", 295);
            btnClose.Click += (s, e) => { this.Hide(); };
            headerPanel.Controls.Add(btnClose);

            this.Controls.Add(headerPanel);

            // 2. Drop Target Panel
            dropTargetPanel = new Panel();
            dropTargetPanel.Location = new Point(14, 48);
            dropTargetPanel.Size = new Size(302, 118);
            dropTargetPanel.BackColor = colCard;
            dropTargetPanel.AllowDrop = true;
            dropTargetPanel.Paint += DropPanelPaint;
            dropTargetPanel.DragEnter += DropPanelDragEnter;
            dropTargetPanel.DragLeave += DropPanelDragLeave;
            dropTargetPanel.DragDrop += DropPanelDragDrop;

            dropIconLabel = new Label();
            dropIconLabel.Text = "⚡";
            dropIconLabel.Font = new Font("Segoe UI", 20f);
            dropIconLabel.ForeColor = colCyan;
            dropIconLabel.TextAlign = ContentAlignment.MiddleCenter;
            dropIconLabel.Location = new Point(0, 10);
            dropIconLabel.Size = new Size(302, 34);
            dropIconLabel.AllowDrop = true;
            dropIconLabel.DragEnter += DropPanelDragEnter;
            dropIconLabel.DragDrop += DropPanelDragDrop;
            dropTargetPanel.Controls.Add(dropIconLabel);

            dropMainLabel = new Label();
            dropMainLabel.Text = "Drag & Drop Files Here";
            dropMainLabel.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            dropMainLabel.ForeColor = Color.White;
            dropMainLabel.TextAlign = ContentAlignment.MiddleCenter;
            dropMainLabel.Location = new Point(0, 46);
            dropMainLabel.Size = new Size(302, 22);
            dropMainLabel.AllowDrop = true;
            dropMainLabel.DragEnter += DropPanelDragEnter;
            dropMainLabel.DragDrop += DropPanelDragDrop;
            dropTargetPanel.Controls.Add(dropMainLabel);

            dropSubLabel = new Label();
            dropSubLabel.Text = "Instant transfer to POCO M6 Pro 5G";
            dropSubLabel.Font = new Font("Segoe UI", 8.0f);
            dropSubLabel.ForeColor = colTextMuted;
            dropSubLabel.TextAlign = ContentAlignment.MiddleCenter;
            dropSubLabel.Location = new Point(0, 68);
            dropSubLabel.Size = new Size(302, 20);
            dropSubLabel.AllowDrop = true;
            dropSubLabel.DragEnter += DropPanelDragEnter;
            dropSubLabel.DragDrop += DropPanelDragDrop;
            dropTargetPanel.Controls.Add(dropSubLabel);

            progressBar = new ProgressBar();
            progressBar.Location = new Point(20, 88);
            progressBar.Size = new Size(262, 8);
            progressBar.Style = ProgressBarStyle.Marquee;
            progressBar.Visible = false;
            dropTargetPanel.Controls.Add(progressBar);

            this.Controls.Add(dropTargetPanel);

            // 3. Bottom Links
            browseLink = new LinkLabel();
            browseLink.Text = "📁 Or click to choose file...";
            browseLink.Font = new Font("Segoe UI", 8.5f);
            browseLink.LinkColor = colCyan;
            browseLink.ActiveLinkColor = Color.White;
            browseLink.AutoSize = true;
            browseLink.Location = new Point(90, 174);
            browseLink.LinkClicked += (s, e) => OpenFileDialogAndSend();
            this.Controls.Add(browseLink);

            // 4. System Tray Integration
            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("📱 Show Drop Zone", null, (s, e) => { this.Show(); this.BringToFront(); });
            trayMenu.Items.Add("📤 Send File to Phone...", null, (s, e) => OpenFileDialogAndSend());
            trayMenu.Items.Add("-");
            trayMenu.Items.Add("Exit", null, (s, e) => Application.Exit());

            trayIcon = new NotifyIcon();
            trayIcon.Text = "Bridge Remote - POCO M6 Pro 5G";
            trayIcon.Icon = SystemIcons.Application;
            trayIcon.ContextMenuStrip = trayMenu;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += (s, e) => { this.Show(); this.BringToFront(); };

            // 5. Polling Timer for Phone Status (every 3 seconds)
            statusTimer = new System.Windows.Forms.Timer();
            statusTimer.Interval = 3000;
            statusTimer.Tick += (s, e) => CheckPhoneStatus();
            statusTimer.Start();
        }

        private Button CreateHeaderButton(string text, int x)
        {
            Button btn = new Button();
            btn.Text = text;
            btn.Font = new Font("Segoe UI", 9f);
            btn.ForeColor = colTextMuted;
            btn.BackColor = Color.Transparent;
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 0;
            btn.FlatAppearance.MouseOverBackColor = Color.FromArgb(40, 53, 75);
            btn.Size = new Size(26, 26);
            btn.Location = new Point(x, 6);
            btn.Cursor = Cursors.Hand;
            return btn;
        }

        // Window Draggability
        private void OnHeaderMouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                isDraggingWindow = true;
                dragStartPoint = e.Location;
            }
        }

        private void OnHeaderMouseMove(object sender, MouseEventArgs e)
        {
            if (isDraggingWindow)
            {
                Point diff = new Point(e.Location.X - dragStartPoint.X, e.Location.Y - dragStartPoint.Y);
                this.Location = new Point(this.Location.X + diff.X, this.Location.Y + diff.Y);
            }
        }

        private void OnHeaderMouseUp(object sender, MouseEventArgs e)
        {
            isDraggingWindow = false;
        }

        // Custom Border Paint for Drop Area
        private bool isDragOver = false;
        private void DropPanelPaint(object sender, PaintEventArgs e)
        {
            using (Pen pen = new Pen(isDragOver ? colCyan : colBorder, 2f))
            {
                pen.DashStyle = DashStyle.Dash;
                Rectangle rect = new Rectangle(1, 1, dropTargetPanel.Width - 3, dropTargetPanel.Height - 3);
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                e.Graphics.DrawRectangle(pen, rect);
            }
        }

        private void DropPanelDragEnter(object sender, DragEventArgs e)
        {
            if (e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                e.Effect = DragDropEffects.Copy;
                isDragOver = true;
                dropTargetPanel.Invalidate();
                dropMainLabel.Text = "Drop to Send!";
                dropMainLabel.ForeColor = colCyan;
            }
        }

        private void DropPanelDragLeave(object sender, EventArgs e)
        {
            isDragOver = false;
            dropTargetPanel.Invalidate();
            if (!isSending)
            {
                dropMainLabel.Text = "Drag & Drop Files Here";
                dropMainLabel.ForeColor = Color.White;
            }
        }

        private void DropPanelDragDrop(object sender, DragEventArgs e)
        {
            isDragOver = false;
            dropTargetPanel.Invalidate();

            if (e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                string[] files = (string[])e.Data.GetData(DataFormats.FileDrop);
                if (files != null && files.Length > 0)
                {
                    SendFileToPhoneAsync(files[0]);
                }
            }
        }

        private void OpenFileDialogAndSend()
        {
            using (OpenFileDialog ofd = new OpenFileDialog())
            {
                ofd.Title = "Select File to Send to POCO M6 Pro 5G";
                ofd.Filter = "All Files (*.*)|*.*";
                if (ofd.ShowDialog() == DialogResult.OK)
                {
                    SendFileToPhoneAsync(ofd.FileName);
                }
            }
        }

        private void SendFileToPhoneAsync(string filePath)
        {
            if (isSending) return;
            isSending = true;

            string fileName = Path.GetFileName(filePath);
            long fileBytes = 0;
            try { fileBytes = new FileInfo(filePath).Length; } catch {}
            string sizeStr = (fileBytes / (1024.0 * 1024.0)).ToString("0.0") + " MB";

            dropIconLabel.Text = "🚀";
            dropMainLabel.Text = "Sending " + fileName;
            dropMainLabel.ForeColor = colCyan;
            dropSubLabel.Text = sizeStr + " • Streaming to phone...";
            progressBar.Visible = true;

            ThreadPool.QueueUserWorkItem((state) => {
                string error = null;
                try
                {
                    // Call local Agent IPC endpoint
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:48484/send-file");
                    request.Method = "POST";
                    request.ContentType = "application/json";
                    request.Timeout = 60000;

                    // Escape path JSON
                    string json = "{\"filePath\":\"" + filePath.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}";
                    byte[] data = Encoding.UTF8.GetBytes(json);
                    request.ContentLength = data.Length;

                    using (Stream stream = request.GetRequestStream())
                    {
                        stream.Write(data, 0, data.Length);
                    }

                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                    {
                        string result = reader.ReadToEnd();
                        if (!result.Contains("\"ok\":true"))
                        {
                            error = "Agent responded with error";
                        }
                    }
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }

                // Update UI on main thread
                this.Invoke((MethodInvoker)delegate {
                    progressBar.Visible = false;
                    isSending = false;

                    if (error == null)
                    {
                        dropIconLabel.Text = "✅";
                        dropMainLabel.Text = "Sent to POCO M6 Pro 5G!";
                        dropMainLabel.ForeColor = colGreen;
                        dropSubLabel.Text = fileName + " delivered";

                        trayIcon.ShowBalloonTip(3000, "Bridge Remote ⚡", "Successfully transferred " + fileName + " to phone!", ToolTipIcon.Info);
                    }
                    else
                    {
                        dropIconLabel.Text = "⚠️";
                        dropMainLabel.Text = "Transfer Failed";
                        dropMainLabel.ForeColor = colRed;
                        dropSubLabel.Text = error.Length > 35 ? error.Substring(0, 32) + "..." : error;
                    }

                    // Reset UI after 3 seconds
                    System.Windows.Forms.Timer resetTimer = new System.Windows.Forms.Timer();
                    resetTimer.Interval = 3000;
                    resetTimer.Tick += (ts, te) => {
                        resetTimer.Stop();
                        resetTimer.Dispose();
                        dropIconLabel.Text = "⚡";
                        dropMainLabel.Text = "Drag & Drop Files Here";
                        dropMainLabel.ForeColor = Color.White;
                        dropSubLabel.Text = "Instant transfer to POCO M6 Pro 5G";
                    };
                    resetTimer.Start();
                });
            });
        }

        private void CheckPhoneStatus()
        {
            ThreadPool.QueueUserWorkItem((state) => {
                bool relayOk = false;
                bool phoneOk = false;
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:48484/status");
                    request.Timeout = 2000;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                    {
                        string body = reader.ReadToEnd();
                        relayOk = body.Contains("\"relayConnected\":true");
                        phoneOk = body.Contains("\"phoneConnected\":true");
                    }
                }
                catch {}

                if (!this.IsDisposed && this.IsHandleCreated)
                {
                    this.Invoke((MethodInvoker)delegate {
                        if (phoneOk)
                        {
                            statusDot.ForeColor = colGreen;
                            statusLabel.Text = "Online";
                        }
                        else if (relayOk)
                        {
                            statusDot.ForeColor = Color.FromArgb(234, 179, 8); // Yellow
                            statusLabel.Text = "Phone Offline";
                        }
                        else
                        {
                            statusDot.ForeColor = colRed;
                            statusLabel.Text = "Agent Offline";
                        }
                    });
                }
            });
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (statusTimer != null) statusTimer.Dispose();
                if (trayIcon != null) trayIcon.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
