# Dùng `sbx` tạo sandbox opencode có IDA (ida-kit)

Hướng dẫn tạo sandbox Docker Sandboxes (`sbx`) chạy opencode cùng mixin `ida-kit`,
cho phép agent dùng IDA Pro qua MCP server `ida-mcp` (headless, idalib).

Kiểm tra trên: `sbx v0.50.1`, macOS (Apple Silicon), sandbox image `opencode` (linux/arm64).

## 1. Thành phần

```
sbx-ida-kit/
├── AGENTS.md                     # rule khi làm việc trên kit (phía host)
└── ida-kit/                      # mixin kit, tự chứa (self-contained)
    ├── spec.yaml
    └── files/home/               # → $HOME của user trong sandbox (/home/agent)
        ├── .config/opencode/
        │   └── AGENTS.md         # global rule: áp cho MỌI session trong sandbox
        └── ida-kit/              # → /home/agent/ida-kit/
            ├── install-ida.sh    # script cài đặt
            ├── runme.js          # tạo license + patch ida/libida
            └── ida/
                └── ida-pro_95_x64linux.run   # installer cho linux/amd64
```

Thêm `ida-pro_95_armlinux.run` vào `ida/` nếu sandbox chạy `linux/arm64`
(Apple Silicon); script tự chọn theo `uname -m`.

`sbx kit inspect --offline ./ida-kit` xác nhận số file sẽ được đổ vào sandbox
(hiện tại `Files: 4 home`).

### AGENTS.md trong kit

`files/home/.config/opencode/AGENTS.md` → `/home/agent/.config/opencode/AGENTS.md`.
OpenCode V2 nạp file này **trước** mọi `AGENTS.md` của project, nên rule trong đó áp
cho mọi session trong sandbox, bất kể workspace nào. Đây là chỗ đặt các quy ước
chung: phạm vi được phép (lab/red team), cách dùng IDA, đường dẫn `$IDADIR`, v.v.

- Rule riêng cho một repo thì để `AGENTS.md` ở gốc repo đó (host bind-mount, không
  cần nằm trong kit).
- Rule riêng cho một thư mục con thì đặt `AGENTS.md` ngay trong thư mục đó; file gần
  workspace nhất được nạp sau cùng.
- Nếu image đặt `XDG_CONFIG_HOME` khác mặc định, OpenCode đọc
  `$XDG_CONFIG_HOME/opencode/AGENTS.md`; khi đó copy thêm file vào đường dẫn đó.
- `AGENTS.md` ở gốc `sbx-ida-kit/` là rule cho việc sửa kit trên host, không được đưa
  vào sandbox — hai file độc lập, sửa cái nào cũng không tự đồng bộ sang cái kia.

`ida-kit/spec.yaml` (kind `mixin`) khai báo:

| Mục | Nội dung |
|-----|----------|
| `environment.variables` | `IDADIR=/opt/ida-pro`, `IDA_NEXUS_IDALIB_ONLY=1`, `OPENCODE_CONFIG_CONTENT` đăng ký MCP server `ida` (`uv tool run ida-mcp stdio`) |
| `permissions.network.allow` | `pypi.org`, `files.pythonhosted.org`, các mirror Ubuntu (cho `uv`, `hcli`, `apt`) |
| `setup.install` | (1) cài `nodejs` nếu image chưa có, chạy bằng root; (2) `bash /home/agent/ida-kit/install-ida.sh`, chạy bằng user `agent` (uid 1000) |

`install-ida.sh` tìm installer và `runme.js` theo thứ tự: `~/ida/` (ưu tiên cao nhất,
dùng để ghi đè) → `<kit>/ida/` → `<kit>/` (nơi có `runme.js`) → `$WORKSPACE_DIR/ida/`.
Nếu không tìm thấy installer đúng kiến trúc, script in ra các đường dẫn đã tìm và thoát
mã 0: sandbox vẫn được tạo, chỉ là chưa có IDA.

Lưu ý kiến trúc: sandbox local trên Mac Apple Silicon là `linux/arm64`, nên cần
`ida-pro_*_armlinux.run`. Trên máy x86_64 thì dùng `ida-pro_*_x64linux.run`.

License không cần file sẵn: `runme.js` sinh `idapro.hexlic` rồi ghi vào cả
`/opt/ida-pro` và `~/.idapro`. Muốn dùng license riêng thì đặt `idapro.hexlic` vào
`~/ida/` và sửa lại bước chạy `runme.js` (hoặc bỏ qua bằng cách patch tay).

## 2. Kiểm tra kit

```bash
cd ~/working/opencode/mobile_audit
sbx kit validate ./ida-kit
sbx kit inspect  ./ida-kit
```

Chưa đăng nhập Docker cũng kiểm tra được (bỏ qua kiểm tra policy của daemon):

```bash
sbx kit validate --offline ./ida-kit
sbx kit inspect  --offline ./ida-kit     # → Files: 4 home
```

## 3. Tạo sandbox

Workspace được bind-mount vào sandbox ở **cùng đường dẫn như trên host**, và
`$WORKSPACE_DIR` trỏ tới đó. Kit đã chứa sẵn installer + `runme.js`, nên không cần
chuẩn bị gì thêm trong workspace.

### Cách A: tạo rồi attach (khuyên dùng)

```bash
cd ~/working/opencode/mobile_audit
sbx create --name opencode-ida opencode --kit ./ida-kit .
sbx run --name opencode-ida
```

### Cách B: tạo và mở opencode ngay

```bash
sbx run --name opencode-ida opencode --kit ./ida-kit .
```

Một số tùy chọn hay dùng khi tạo:

```bash
# Thêm thư mục chứa binary/APK cần phân tích (chỉ đọc)
sbx create --name opencode-ida opencode --kit ./ida-kit . ~/samples:ro

# Giới hạn tài nguyên (IDA phân tích binary lớn khá tốn RAM)
sbx create --name opencode-ida --cpus 4 -m 8g opencode --kit ./ida-kit .
```

### Thêm kit vào sandbox opencode có sẵn

```bash
sbx kit add opencode-audit ./ida-kit
```

Lệnh này tạo lại container với kit mới; dữ liệu workspace không bị ảnh hưởng.

## 4. Kiểm tra IDA trong sandbox

```bash
sbx exec opencode-ida bash -lc '
  echo "IDADIR=$IDADIR  WORKSPACE_DIR=$WORKSPACE_DIR"
  test -x "$IDADIR/idat" && echo "idat: OK"
  ls ~/.idapro/venv/bin/python3
  opencode mcp list
'
```

Kết quả mong đợi: `idat: OK`, có venv tại `~/.idapro/venv`, và `opencode mcp list` hiển
thị server `ida`.

### Cài lại / ghi đè installer

Installer và `runme.js` đã nằm trong kit (`/home/agent/ida-kit/`), nên thường chỉ cần
chạy lại script:

```bash
sbx exec -it opencode-ida bash /home/agent/ida-kit/install-ida.sh
```

Khi cần dùng bản installer khác (ví dụ kit chưa có đúng kiến trúc), copy vào `~/ida`
của sandbox — thư mục này được ưu tiên hơn bản trong kit:

```bash
sbx exec opencode-ida mkdir -p /home/agent/ida
sbx cp ./ida/ida-pro_95_armlinux.run opencode-ida:/home/agent/ida/
sbx exec -it opencode-ida bash /home/agent/ida-kit/install-ida.sh
```

## 5. Sử dụng

Mở opencode trong sandbox:

```bash
sbx run --name opencode-ida
```

MCP server `ida` khởi động theo yêu cầu, lần đầu `uv` sẽ tải gói `ida-mcp`. Ví dụ prompt:

```
Mở /Users/macbook/working/opencode/mobile_audit/target/libnative.so bằng IDA,
liệt kê các hàm JNI_OnLoad / Java_* và decompile JNI_OnLoad.
```

Nên đặt binary cần phân tích trong workspace (hoặc trong thư mục mount `:ro`) để agent
truy cập bằng đường dẫn host. Database `.i64` được ghi cạnh binary, nên khi file nằm
trong mount `:ro` thì cần copy nó vào workspace trước.

Mở shell để làm việc thủ công:

```bash
sbx exec -it opencode-ida bash
# trong sandbox:
$IDADIR/idat -A -B -o/tmp/test.i64 ./target/libnative.so   # phân tích headless
```

Chép file giữa host và sandbox:

```bash
sbx cp opencode-ida:/tmp/test.i64 ./out/
sbx cp ./bin/sample opencode-ida:/home/agent/
```

## 6. Quản lý vòng đời

```bash
sbx ls                    # liệt kê sandbox
sbx stop opencode-ida     # dừng (giữ nguyên trạng thái, IDA đã cài)
sbx run --name opencode-ida   # chạy lại và attach
sbx rm opencode-ida       # xóa (lần tạo sau sẽ cài lại IDA)
sbx tui                   # dashboard tương tác
```

Thoát phiên opencode không làm mất sandbox. Dùng `sbx stop` thay cho `rm` để khỏi phải
cài lại IDA.

## 7. Xử lý sự cố

| Triệu chứng | Nguyên nhân / cách xử lý |
|-------------|--------------------------|
| Log tạo sandbox có `IDA not installed yet.` | Thiếu installer đúng kiến trúc cho máy này. Đọc các dòng `this machine` / `missing` / `looked in`, và `wrong arch` nếu kit có installer của kiến trúc khác. Thêm file vào `files/home/ida-kit/ida/` rồi `sbx kit add`, hoặc copy vào `~/ida` của sandbox (mục 4) |
| Agent không thấy rule trong sandbox | Kiểm tra `ls ~/.config/opencode/AGENTS.md` bên trong sandbox. Nếu image đặt `XDG_CONFIG_HOME` khác mặc định thì file phải nằm trong `$XDG_CONFIG_HOME/opencode/` |
| `no match` khi chạy `runme.js` | Bản IDA khác với bản script nhắm tới (9.4 beta1 / 9.5); pattern patch không còn khớp. Cần cập nhật `SEARCH`/`REPLACE` |
| `node not found, but runme.js needs it` | Image không có node và bước cài node trong `spec.yaml` thất bại. Cài lại bằng `sbx kit add` hoặc `apt-get install nodejs` |
| `idat rejected ...` khi smoke test | License không hợp lệ cho bản IDA này. Xoá `~/.idapro/idapro.hexlic` và `/opt/ida-pro/idapro.hexlic` rồi chạy lại script |
| `opencode mcp list` không có `ida` | Sandbox được tạo không kèm `--kit ./ida-kit` nên thiếu `OPENCODE_CONFIG_CONTENT`. Dùng `sbx kit add` |
| `ida-mcp` lỗi do lệch phiên bản Python | Venv không khớp Python mà IDA nhúng. Chạy lại `install-ida.sh` (script sẽ tạo lại `~/.idapro/venv`) |
| `uv`/`hcli` báo `EACCES` | File trong `~/.idapro`, `~/.cache/uv` hoặc `~/.local/share/uv` bị root sở hữu: `sbx exec -u root opencode-ida chown -R agent: /home/agent/.idapro /home/agent/.cache/uv /home/agent/.local/share/uv` |
| Tải gói bị chặn | Domain chưa có trong network allowlist. Xem `sbx policy ls opencode-ida`, rồi bổ sung vào `permissions.network.allow` trong `spec.yaml` |
| Lỗi chung của `sbx` | `sbx diagnose`, hoặc chạy lại lệnh với `-D` |
