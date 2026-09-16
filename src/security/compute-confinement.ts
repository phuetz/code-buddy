/** Kernel-enforced compute sandbox. Fail closed if the required Linux facilities are absent. */
import { realpathSync } from 'node:fs';

// Bootstrap is trusted, runs before user code, and applies restrictions inherited across exec.
// Landlock restricts file content access; seccomp denies networking and cross-process access.
const BOOTSTRAP = String.raw`
import ctypes, errno, os, platform, resource, sys
libc = ctypes.CDLL(None, use_errno=True)
def check(value):
    if value < 0: raise OSError(ctypes.get_errno(), 'compute confinement unavailable')
    return value
arch = platform.machine()
if arch not in ('x86_64', 'aarch64'): raise RuntimeError('unsupported compute sandbox architecture')
abi = check(libc.syscall(444, 0, 0, 1))
if abi < 3: raise RuntimeError('compute sandbox requires Landlock ABI 3 or newer')
root, executable = sys.argv[1:3]
class Rules(ctypes.Structure):
    _fields_ = [('access', ctypes.c_uint64)]
class PathRule(ctypes.Structure):
    _pack_ = 1
    _fields_ = [('access', ctypes.c_uint64), ('fd', ctypes.c_int32)]
rights = (1 << 15) - 1
rules = Rules(rights)
fd = check(libc.syscall(444, ctypes.byref(rules), ctypes.sizeof(rules), 0))
def allow(p, access):
    if not os.path.exists(p): return
    p = os.path.realpath(p)
    if not os.path.isdir(p): access &= (1 | 2 | 4 | (1 << 14))
    handle = os.open(p, os.O_PATH | os.O_CLOEXEC)
    try:
        rule = PathRule(access, handle)
        check(libc.syscall(445, fd, 1, ctypes.byref(rule), 0))
    finally: os.close(handle)
# Runtime libraries are readable, never writable or executable as programs.
for p in ('/usr/lib', '/usr/lib64', '/usr/local/lib', '/usr/share/nodejs', '/usr/share/zoneinfo', '/lib', '/lib64', '/etc/ld.so.cache', '/dev/null', '/dev/urandom'):
    allow(p, 4 | 8)
allow(root, rights & ~(1 | (1 << 6) | (1 << 9) | (1 << 10) | (1 << 11) | (1 << 12)))
allow(executable, 1 | 4)
allow('/lib64/ld-linux-x86-64.so.2' if arch == 'x86_64' else '/lib/ld-linux-aarch64.so.1', 1 | 4)
# Drop inherited capabilities as well (the host may itself run as root).
class CapHeader(ctypes.Structure):
    _fields_ = [('version',ctypes.c_uint32),('pid',ctypes.c_int)]
class CapData(ctypes.Structure):
    _fields_ = [('effective',ctypes.c_uint32),('permitted',ctypes.c_uint32),('inheritable',ctypes.c_uint32)]
cap_header, cap_data = CapHeader(0x20080522, 0), (CapData * 2)()
check(libc.capset(ctypes.byref(cap_header), ctypes.byref(cap_data)))
check(libc.prctl(38, 1, 0, 0, 0)) # PR_SET_NO_NEW_PRIVS
check(libc.syscall(446, fd, 0))
os.close(fd)
class Filter(ctypes.Structure):
    _fields_ = [('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint32)]
class Program(ctypes.Structure):
    _fields_ = [('len',ctypes.c_ushort),('filter',ctypes.POINTER(Filter))]
# Check audit architecture, deny x32 ABI, then block sockets, ptrace, process_vm,
# pidfd, io_uring, signals to other processes and namespace/mount manipulation.
expected = 0xc000003e if arch == 'x86_64' else 0xc00000b7
denied = ([41,42,43,44,45,46,47,49,50,53,288,101,310,311,424,425,426,434,438,62,200,234,57,58,165,166,272,308]
          if arch == 'x86_64' else [198,203,202,206,207,211,212,200,201,199,242,117,270,271,424,425,426,434,438,129,130,131,40,39,97,268])
ops = [Filter(0x20,0,0,4), Filter(0x15,1,0,expected), Filter(0x06,0,0,0x80000000), Filter(0x20,0,0,0)]
if arch == 'x86_64': ops += [Filter(0x45,0,1,0x40000000), Filter(0x06,0,0,0x80000000)]
# Deny process creation, while allowing CLONE_THREAD for interpreter worker threads.
clone = 56 if arch == 'x86_64' else 220
ops += [Filter(0x15,0,4,clone), Filter(0x20,0,0,16), Filter(0x45,1,0,0x10000), Filter(0x06,0,0,0x00050000 | errno.EPERM), Filter(0x06,0,0,0x7fff0000)]
# libc retries clone() when clone3 reports ENOSYS.
ops += [Filter(0x15,0,1,435), Filter(0x06,0,0,0x00050000 | errno.ENOSYS)]
for nr in denied: ops += [Filter(0x15,0,1,nr),Filter(0x06,0,0,0x00050000 | errno.EPERM)]
ops += [Filter(0x06,0,0,0x7fff0000)]
filters = (Filter * len(ops))(*ops)
program = Program(len(ops), filters)
check(libc.prctl(22, 2, ctypes.byref(program), 0, 0)) # SECCOMP_MODE_FILTER
resource.setrlimit(resource.RLIMIT_CORE, (0,0))
resource.setrlimit(resource.RLIMIT_DATA, (536870912,536870912))
resource.setrlimit(resource.RLIMIT_FSIZE, (2097152,2097152))
resource.setrlimit(resource.RLIMIT_NOFILE, (128,128))
resource.setrlimit(resource.RLIMIT_CPU, (30,30))
os.environ['OPENSSL_CONF'] = '/dev/null'
for key in ('TMPDIR','TMP','TEMP'): os.environ[key] = root
os.environ.pop('NODE_PATH', None)
os.environ.pop('NODE_OPTIONS', None)
args = sys.argv[3:]
if os.path.basename(executable) == 'node': args = ['--jitless', '--max-old-space-size=96'] + args
os.execv(executable, [executable] + args)
`;

export function confineComputeInvocation(command: string, args: string[], root: string): { command: string; args: string[] } {
  if (process.platform !== 'linux') throw new Error('Compute confinement requires Linux Landlock/seccomp; refusing unrestricted execution');
  const executable = realpathSync(command === 'python3' ? '/usr/bin/python3' : command);
  return { command: '/usr/bin/python3', args: ['-I', '-c', BOOTSTRAP, realpathSync(root), executable, ...args] };
}
