import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { KnowledgeGraph } from '@/knowledge/knowledge-graph.js';
import { populateDeepCodeGraph } from '@/knowledge/code-graph-deep-populator.js';
import { PythonScanner } from '@/knowledge/scanners/python.js';
import { GoScanner } from '@/knowledge/scanners/go.js';
import { RustScanner } from '@/knowledge/scanners/rust.js';
import { JavaScanner } from '@/knowledge/scanners/java.js';

// ============================================================================
// Python Tests
// ============================================================================

function createPythonProject(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-py-'));
  const srcDir = path.join(tmpDir, 'src');
  fs.mkdirSync(path.join(srcDir, 'utils'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'services'), { recursive: true });

  fs.writeFileSync(path.join(srcDir, 'utils', 'logger.py'), `
class Logger:
    def __init__(self, name: str):
        self.name = name

    def info(self, msg: str) -> None:
        print(f"[{self.name}] {msg}")

    def warn(self, msg: str) -> None:
        print(f"WARN: {msg}")

    def debug(self, msg: str) -> None:
        print(f"DEBUG: {msg}")

def create_logger(name: str) -> Logger:
    return Logger(name)

logger = create_logger("default")
`);

  fs.writeFileSync(path.join(srcDir, 'services', 'user_service.py'), `
from utils.logger import Logger, create_logger

class UserService:
    def __init__(self):
        self.logger = create_logger("UserService")

    async def get_user(self, user_id: str) -> dict:
        self.logger.info("Getting user")
        user = await self.fetch_from_db(user_id)
        self.validate_user(user)
        return user

    async def fetch_from_db(self, user_id: str) -> dict:
        self.logger.debug("Fetching from DB")
        return {"id": user_id, "name": "test"}

    def validate_user(self, user: dict) -> None:
        if not user.get("id"):
            self.logger.warn("Invalid user")
`);

  fs.writeFileSync(path.join(srcDir, 'services', 'admin_service.py'), `
from services.user_service import UserService

class AdminService(UserService):
    async def delete_user(self, user_id: str) -> None:
        user = await self.get_user(user_id)
        self.perform_delete(user)

    def perform_delete(self, user: dict) -> None:
        pass

    def audit(self) -> None:
        pass
`);

  // Test file — should be skipped
  fs.writeFileSync(path.join(srcDir, 'test_user_service.py'), `
def test_get_user():
    pass
`);

  return tmpDir;
}

describe('Python Scanner', () => {
  let graph: KnowledgeGraph;
  let tmpDir: string;

  beforeEach(() => {
    KnowledgeGraph.resetInstance();
    graph = KnowledgeGraph.getInstance();
    tmpDir = createPythonProject();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });

  it('populates class definitions', () => {
    const added = populateDeepCodeGraph(graph, tmpDir, ['src']);
    expect(added).toBeGreaterThan(0);

    const loggerTriples = graph.query({ subject: 'cls:Logger', predicate: 'definedIn' });
    expect(loggerTriples.length).toBe(1);
    expect(loggerTriples[0].object).toContain('logger');

    const userSvcTriples = graph.query({ subject: 'cls:UserService', predicate: 'definedIn' });
    expect(userSvcTriples.length).toBe(1);
  });

  it('populates extends relationships', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);
    expect(graph.has('cls:AdminService', 'extends', 'cls:UserService')).toBe(true);
  });

  it('populates class methods', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.info')).toBe(true);
    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.warn')).toBe(true);
    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.debug')).toBe(true);

    expect(graph.has('cls:UserService', 'hasMethod', 'fn:UserService.get_user')).toBe(true);
    expect(graph.has('cls:UserService', 'hasMethod', 'fn:UserService.fetch_from_db')).toBe(true);
    expect(graph.has('cls:UserService', 'hasMethod', 'fn:UserService.validate_user')).toBe(true);
  });

  it('populates function definitions', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const createLoggerTriples = graph.query({ subject: 'fn:create_logger', predicate: 'definedIn' });
    expect(createLoggerTriples.length).toBe(1);
  });

  it('populates self.method() call edges', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const callTriples = graph.query({ subject: 'fn:UserService.get_user', predicate: 'calls' });
    const callees = callTriples.map(t => t.object);
    expect(callees).toContain('fn:UserService.fetch_from_db');
    expect(callees).toContain('fn:UserService.validate_user');
  });

  it('skips test files', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const testTriples = graph.query({ subject: 'fn:test_get_user' });
    expect(testTriples.length).toBe(0);
  });

  it('stores parameter signatures', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const loggerMethods = graph.query({ subject: 'cls:Logger', predicate: 'hasMethod' });
    const infoMethod = loggerMethods.find(t => t.object === 'fn:Logger.info');
    expect(infoMethod).toBeDefined();
    expect(infoMethod!.metadata?.params).toContain('msg: str');
    expect(infoMethod!.metadata?.returnType).toBe('None');
  });

  it('strips self from params', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const loggerMethods = graph.query({ subject: 'cls:Logger', predicate: 'hasMethod' });
    const info = loggerMethods.find(t => t.object === 'fn:Logger.info');
    // Should not contain 'self'
    expect(info!.metadata?.params).not.toContain('self');
  });

  it('stores function return types', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const createLoggerTriples = graph.query({ subject: 'fn:create_logger', predicate: 'definedIn' });
    expect(createLoggerTriples[0].metadata?.returnType).toBe('Logger');
  });
});

// ============================================================================
// Go Tests
// ============================================================================

function createGoProject(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-go-'));
  const srcDir = path.join(tmpDir, 'src');
  fs.mkdirSync(path.join(srcDir, 'service'), { recursive: true });

  fs.writeFileSync(path.join(srcDir, 'service', 'logger.go'), `package service

type Logger struct {
    Name string
}

func NewLogger(name string) *Logger {
    return &Logger{Name: name}
}

func (l *Logger) Info(msg string) {
    // log info
}

func (l *Logger) Warn(msg string) {
    // log warn
}
`);

  fs.writeFileSync(path.join(srcDir, 'service', 'user_service.go'), `package service

type UserService struct {
    Logger
    name string
}

func NewUserService() *UserService {
    return &UserService{name: "default"}
}

func (s *UserService) GetUser(id string) (User, error) {
    s.Info("Getting user")
    return s.fetchFromDb(id)
}

func (s *UserService) fetchFromDb(id string) (User, error) {
    return User{ID: id}, nil
}
`);

  // Test file — should be skipped
  fs.writeFileSync(path.join(srcDir, 'service', 'user_service_test.go'), `package service

func TestGetUser(t *testing.T) {}
`);

  return tmpDir;
}

describe('Go Scanner', () => {
  let graph: KnowledgeGraph;
  let tmpDir: string;

  beforeEach(() => {
    KnowledgeGraph.resetInstance();
    graph = KnowledgeGraph.getInstance();
    tmpDir = createGoProject();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  });

  it('populates struct definitions', () => {
    const added = populateDeepCodeGraph(graph, tmpDir, ['src']);
    expect(added).toBeGreaterThan(0);

    const loggerTriples = graph.query({ subject: 'cls:Logger', predicate: 'definedIn' });
    expect(loggerTriples.length).toBe(1);
    expect(loggerTriples[0].object).toContain('logger');
  });

  it('populates struct embedding as extends', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);
    expect(graph.has('cls:UserService', 'extends', 'cls:Logger')).toBe(true);
  });

  it('populates methods with receivers', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.Info')).toBe(true);
    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.Warn')).toBe(true);
    expect(graph.has('cls:UserService', 'hasMethod', 'fn:UserService.GetUser')).toBe(true);
    expect(graph.has('cls:UserService', 'hasMethod', 'fn:UserService.fetchFromDb')).toBe(true);
  });

  it('populates top-level function definitions', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const newLoggerTriples = graph.query({ subject: 'fn:NewLogger', predicate: 'definedIn' });
    expect(newLoggerTriples.length).toBe(1);

    const newUserSvcTriples = graph.query({ subject: 'fn:NewUserService', predicate: 'definedIn' });
    expect(newUserSvcTriples.length).toBe(1);
  });

  it('populates method call edges', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const callTriples = graph.query({ subject: 'fn:UserService.GetUser', predicate: 'calls' });
    const callees = callTriples.map(t => t.object);
    expect(callees).toContain('fn:UserService.fetchFromDb');
  });

  it('skips test files', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const testTriples = graph.query({ subject: 'fn:TestGetUser' });
    expect(testTriples.length).toBe(0);
  });

  it('stores parameter signatures', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const methods = graph.query({ subject: 'cls:Logger', predicate: 'hasMethod' });
    const info = methods.find(t => t.object === 'fn:Logger.Info');
    expect(info!.metadata?.params).toContain('msg string');
  });

  it('stores return types', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const newLoggerTriples = graph.query({ subject: 'fn:NewLogger', predicate: 'definedIn' });
    expect(newLoggerTriples[0].metadata?.returnType).toContain('Logger');
  });
});

// ============================================================================
// Rust Scanner (unit-level)
// ============================================================================

describe('Rust Scanner', () => {
  const scanner = new RustScanner();

  it('extracts structs', () => {
    const result = scanner.scanFile(`
pub struct Logger {
    name: String,
}
`, 'src/logger');
    const cls = result.symbols.find(s => s.name === 'Logger');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');
  });

  it('extracts trait definitions', () => {
    const result = scanner.scanFile(`
pub trait Auditable {
    fn audit(&self);
}
`, 'src/audit');
    const iface = result.symbols.find(s => s.name === 'Auditable');
    expect(iface).toBeDefined();
    expect(iface!.fqn).toBe('iface:Auditable');
  });

  it('extracts impl methods with params', () => {
    const result = scanner.scanFile(`
struct UserService {
    name: String,
}

impl UserService {
    pub fn get_user(&self, id: &str) -> Option<User> {
        self.fetch_from_db(id)
    }

    fn fetch_from_db(&self, id: &str) -> Option<User> {
        None
    }
}
`, 'src/service');
    const methods = result.symbols.filter(s => s.kind === 'method');
    expect(methods.length).toBe(2);

    const getUser = methods.find(s => s.name === 'get_user');
    expect(getUser!.className).toBe('UserService');
    expect(getUser!.params).toContain('id: &str');
    expect(getUser!.params).not.toContain('&self');
    expect(getUser!.returnType).toContain('Option<User>');
  });

  it('extracts impl Trait for Struct as implements', () => {
    const result = scanner.scanFile(`
trait Display {
    fn display(&self) -> String;
}

struct Foo {}

impl Display for Foo {
    fn display(&self) -> String {
        String::new()
    }
}
`, 'src/foo');
    expect(result.inheritance).toContainEqual({
      className: 'Foo',
      implements: ['Display'],
    });
  });

  it('extracts self.method() calls', () => {
    const result = scanner.scanFile(`
impl UserService {
    pub fn get_user(&self, id: &str) -> Option<User> {
        self.validate(id);
        self.fetch_from_db(id)
    }

    fn validate(&self, id: &str) {}
    fn fetch_from_db(&self, id: &str) -> Option<User> { None }
}
`, 'src/service');
    const calls = result.calls.filter(c => c.callerFqn === 'fn:UserService.get_user');
    const callees = calls.map(c => c.calleeName);
    expect(callees).toContain('validate');
    expect(callees).toContain('fetch_from_db');
  });
});

// ============================================================================
// Java Scanner (unit-level)
// ============================================================================

describe('Java Scanner', () => {
  const scanner = new JavaScanner();

  it('extracts class with extends and implements', () => {
    const result = scanner.scanFile(`
public class AdminService extends UserService implements Auditable, Serializable {
    public void deleteUser(String id) {
        this.getUser(id);
    }
}
`, 'src/admin');
    const cls = result.symbols.find(s => s.name === 'AdminService');
    expect(cls).toBeDefined();
    expect(cls!.kind).toBe('class');

    expect(result.inheritance[0]).toEqual({
      className: 'AdminService',
      extends: 'UserService',
      implements: ['Auditable', 'Serializable'],
    });
  });

  it('extracts methods with return-type-before-name', () => {
    const result = scanner.scanFile(`
public class UserService {
    public User getUser(String id) {
        return this.fetchFromDb(id);
    }

    private User fetchFromDb(String id) {
        return null;
    }

    public List<User> getAllUsers() {
        return null;
    }
}
`, 'src/user');
    const methods = result.symbols.filter(s => s.kind === 'method');
    expect(methods.length).toBe(3);

    const getUser = methods.find(s => s.name === 'getUser');
    expect(getUser!.className).toBe('UserService');
    expect(getUser!.params).toContain('String id');
    expect(getUser!.returnType).toBe('User');

    const getAll = methods.find(s => s.name === 'getAllUsers');
    expect(getAll!.returnType).toContain('List');
  });

  it('extracts interface definitions', () => {
    const result = scanner.scanFile(`
public interface Auditable extends Loggable {
    void audit();
}
`, 'src/audit');
    const iface = result.symbols.find(s => s.name === 'Auditable');
    expect(iface).toBeDefined();
    expect(iface!.fqn).toBe('iface:Auditable');
    expect(result.inheritance).toContainEqual({
      className: 'Auditable',
      extends: 'Loggable',
    });
  });

  it('extracts this.method() calls', () => {
    const result = scanner.scanFile(`
public class UserService {
    public User getUser(String id) {
        this.validate(id);
        return this.fetchFromDb(id);
    }
    private void validate(String id) {}
    private User fetchFromDb(String id) { return null; }
}
`, 'src/user');
    const calls = result.calls.filter(c => c.callerFqn === 'fn:UserService.getUser');
    const callees = calls.map(c => c.calleeName);
    expect(callees).toContain('validate');
    expect(callees).toContain('fetchFromDb');
  });
});
