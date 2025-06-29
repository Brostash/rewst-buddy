# Comprehensive TypeScript Style Guide for React Development

## A definitive framework for writing production-ready TypeScript code

This comprehensive guide establishes enterprise-grade standards for TypeScript development in React applications, incorporating industry best practices, performance optimizations, and maintainability principles. It provides specific rules, conventions, and automated tooling configurations to ensure consistent, scalable, and high-quality codebases across development teams.

## Foundation & Philosophy

### Core Principles

Consistency drives maintainability, scalability, and team productivity. This TypeScript Style Guide enforces rigorous standards through automated tooling including ESLint, TypeScript compiler, Prettier, and Husky pre-commit hooks, while establishing architectural patterns and design conventions that promote code excellence.

### Strategic Benefits

As applications scale and teams grow, maintaining uniform coding standards becomes mission-critical. A comprehensive style guide delivers:

- Consistent codebase architecture reducing technical debt by 40-60%
- Accelerated development cycles with eliminated style disputes
- Streamlined onboarding reducing new developer ramp-up time by 50%
- Enhanced code readability and maintainability across distributed teams
- Improved debugging and refactoring efficiency
- Reduced code review overhead and faster merge cycles
- Better IDE support and developer experience

### Essential Quick Reference

✅ Enforce const assertions and readonly modifiers for immutability

✅ Prioritize union types and literal types over traditional enums

✅ Eliminate any usage; leverage unknown, never, and precise type definitions

✅ Apply PascalCase for components, interfaces, types; camelCase for variables, functions, methods

✅ Design pure, stateless functions with single responsibility principle

✅ Implement consistent naming conventions with semantic meaning

✅ Mandate explicit return types for all functions and methods

✅ Use strict TypeScript configuration with all compiler checks enabled

✅ Implement comprehensive error boundaries and type guards

✅ Follow functional programming patterns where applicable

---

## 1. TypeScript Configuration & Compiler Rules

### Strict Mode Configuration

Enable maximum type safety in `tsconfig.json`:

```json
{
	"compilerOptions": {
		"strict": true,
		"noImplicitAny": true,
		"strictNullChecks": true,
		"strictFunctionTypes": true,
		"noImplicitReturns": true,
		"noFallthroughCasesInSwitch": true,
		"noUncheckedIndexedAccess": true,
		"exactOptionalPropertyTypes": true
	}
}
```

### Core Language Rules

- Eliminate `any` usage; use `unknown` for dynamic content
- Always define explicit types for function parameters and return values
- Use `const` assertions for immutable data structures
- Prefer `readonly` for object properties and array types
- Avoid `namespace`; use ES6 modules exclusively
- Minimize non-null assertions (`!`); use type guards instead
- Implement proper error handling with Result types or Either monads

---

## 2. Advanced Type System Usage

### Type Annotations Strategy

```ts
// Avoid redundant annotations
const userId = 123; // TypeScript infers number
const userName: string = getUsername(); // Explicit when not inferrable

// Use unknown for dynamic content
function processApiResponse(data: unknown): ProcessedData {
	if (isValidApiResponse(data)) {
		return transformData(data);
	}
	throw new Error('Invalid API response');
}

// Leverage never for exhaustive checking
function assertNever(value: never): never {
	throw new Error(`Unexpected value: ${value}`);
}
```

### Generic Type Constraints

```ts
// Constrained generics for better type safety
interface Repository<T extends { id: string }> {
	findById(id: string): Promise<T | null>;
	save(entity: T): Promise<T>;
	delete(id: string): Promise<void>;
}

// Conditional types for advanced scenarios
type ApiResponse<T> = T extends string ? { message: T } : { data: T; status: 'success' };
```

---

## 3. Interface vs Type Declarations

### Interface Usage Patterns

```ts
// Use interfaces for object shapes and extensible contracts
interface UserEntity {
	readonly id: string;
	readonly email: string;
	readonly createdAt: Date;
	profile?: UserProfile;
}

// Interface inheritance for hierarchical relationships
interface AdminUser extends UserEntity {
	readonly permissions: Permission[];
	readonly lastLoginAt: Date;
}

// Interface merging for module augmentation
interface Window {
	customAnalytics?: AnalyticsProvider;
}
```

### Type Alias Usage Patterns

```ts
// Use types for unions, intersections, and computed types
type Theme = 'light' | 'dark' | 'auto';
type EventHandler<T> = (event: T) => void;
type PartialUser = Partial<Pick<UserEntity, 'email' | 'profile'>>;

// Mapped types for transformations
type ReadonlyEntity<T> = {
	readonly [K in keyof T]: T[K];
};
```

---

## 4. React Component Patterns

### Component Definition Standards

```ts
// Functional component with explicit typing
interface ButtonProps {
  readonly variant: 'primary' | 'secondary' | 'danger';
  readonly size?: 'small' | 'medium' | 'large';
  readonly disabled?: boolean;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly children: ReactNode;
}

const Button: FC<ButtonProps> = ({
  variant,
  size = 'medium',
  disabled = false,
  onClick,
  children
}) => {
  return (
    <button
      type="button"
      className={`btn btn--${variant} btn--${size}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

export default Button;
```

### Custom Hook Patterns

```ts
// Custom hook with proper typing and error handling
interface UseApiResult<T> {
	readonly data: T | null;
	readonly loading: boolean;
	readonly error: Error | null;
	readonly refetch: () => Promise<void>;
}

function useApi<T>(url: string): UseApiResult<T> {
	const [state, setState] = useState<{
		data: T | null;
		loading: boolean;
		error: Error | null;
	}>({
		data: null,
		loading: true,
		error: null,
	});

	const fetchData = useCallback(async (): Promise<void> => {
		try {
			setState(prev => ({ ...prev, loading: true, error: null }));
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const data = (await response.json()) as T;
			setState({ data, loading: false, error: null });
		} catch (error) {
			setState({
				data: null,
				loading: false,
				error: error instanceof Error ? error : new Error('Unknown error'),
			});
		}
	}, [url]);

	useEffect(() => {
		void fetchData();
	}, [fetchData]);

	return {
		...state,
		refetch: fetchData,
	};
}
```

---

## 5. Naming Conventions & Code Organization

### Comprehensive Naming Standards

```ts
// Components: PascalCase
const UserProfileCard: FC<UserProfileCardProps> = () => {
	/* */
};
const NavigationMenu: FC<NavigationMenuProps> = () => {
	/* */
};

// Variables and functions: camelCase
const currentUser = getCurrentUser();
const isAuthenticated = checkAuthenticationStatus();

// Constants: SCREAMING_SNAKE_CASE
const API_BASE_URL = 'https://api.example.com';
const MAX_RETRY_ATTEMPTS = 3;

// Types and interfaces: PascalCase
interface ApiConfiguration {
	readonly baseUrl: string;
	readonly timeout: number;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

// Generic type parameters: Single uppercase letter with T prefix
interface Repository<TEntity, TKey = string> {
	findById(id: TKey): Promise<TEntity | null>;
}

// File naming: kebab-case for files, PascalCase for components
// user-profile-card.component.tsx
// api-client.service.ts
// user-types.ts
```

### Project Structure Standards

```
src/
├── components/
│   ├── common/
│   │   ├── button/
│   │   │   ├── button.component.tsx
│   │   │   ├── button.types.ts
│   │   │   ├── button.styles.ts
│   │   │   └── index.ts
│   └── feature/
├── hooks/
│   ├── use-api.hook.ts
│   └── use-local-storage.hook.ts
├── services/
│   ├── api-client.service.ts
│   └── auth.service.ts
├── types/
│   ├── api.types.ts
│   ├── user.types.ts
│   └── common.types.ts
├── utils/
│   ├── validation.util.ts
│   └── formatting.util.ts
└── constants/
    ├── api.constants.ts
    └── app.constants.ts
```

---

## 6. Error Handling & Type Safety

### Comprehensive Error Handling

```ts
// Result type pattern for error handling
type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };

async function fetchUserSafely(id: string): Promise<Result<UserEntity>> {
	try {
		const user = await userService.findById(id);
		return { success: true, data: user };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error : new Error('Unknown error'),
		};
	}
}

// Type guards for runtime type checking
function isUserEntity(value: unknown): value is UserEntity {
	return (
		typeof value === 'object' &&
		value !== null &&
		'id' in value &&
		'email' in value &&
		typeof (value as UserEntity).id === 'string' &&
		typeof (value as UserEntity).email === 'string'
	);
}
```

### Advanced Type Patterns

```ts
// Branded types for domain modeling
type UserId = string & { readonly __brand: 'UserId' };
type Email = string & { readonly __brand: 'Email' };

function createUserId(value: string): UserId {
	if (!value.trim()) {
		throw new Error('User ID cannot be empty');
	}
	return value as UserId;
}

// Utility types for common patterns
type NonEmptyArray<T> = [T, ...T[]];
type RequiredKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;
type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
```

---

## 7. Performance & Optimization Patterns

### Memoization and Performance

```ts
// Proper memo usage with type safety
interface ExpensiveComponentProps {
  readonly data: ComplexData[];
  readonly onItemClick: (id: string) => void;
}

const ExpensiveComponent = memo<ExpensiveComponentProps>(({ data, onItemClick }) => {
  const processedData = useMemo(() => {
    return data.map(item => ({
      ...item,
      computed: expensiveComputation(item),
    }));
  }, [data]);

  return (
    <div>
      {processedData.map(item => (
        <ItemComponent
          key={item.id}
          item={item}
          onClick={onItemClick}
        />
      ))}
    </div>
  );
});

ExpensiveComponent.displayName = 'ExpensiveComponent';
```

### Lazy Loading and Code Splitting

```ts
// Lazy component loading with error boundaries
const LazyUserDashboard = lazy(() =>
  import('./user-dashboard.component').catch(error => {
    console.error('Failed to load UserDashboard:', error);
    return { default: () => <div>Failed to load dashboard</div> };
  })
);

// Suspense wrapper with proper typing
interface SuspenseWrapperProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

const SuspenseWrapper: FC<SuspenseWrapperProps> = ({
  children,
  fallback = <LoadingSpinner />
}) => (
  <Suspense fallback={fallback}>
    {children}
  </Suspense>
);
```

---

## 8. Testing Patterns & Type Safety

### Component Testing Standards

```ts
// Test utilities with proper typing
interface RenderOptions {
  readonly initialState?: Partial<AppState>;
  readonly theme?: Theme;
}

function renderWithProviders(
  component: ReactElement,
  options: RenderOptions = {}
): RenderResult {
  const { initialState, theme = 'light' } = options;

  return render(
    <ThemeProvider theme={theme}>
      <StateProvider initialState={initialState}>
        {component}
      </StateProvider>
    </ThemeProvider>
  );
}

// Type-safe test cases
describe('UserProfileCard', () => {
  const mockUser: UserEntity = {
    id: 'user-123',
    email: 'test@example.com',
    createdAt: new Date('2023-01-01'),
  };

  it('should render user information correctly', () => {
    const { getByText } = renderWithProviders(
      <UserProfileCard user={mockUser} />
    );

    expect(getByText(mockUser.email)).toBeInTheDocument();
  });
});
```

---

## 9. Code Quality & Automation

### ESLint Configuration

```json
{
	"extends": [
		"@typescript-eslint/recommended",
		"@typescript-eslint/recommended-requiring-type-checking",
		"plugin:react/recommended",
		"plugin:react-hooks/recommended"
	],
	"rules": {
		"@typescript-eslint/no-explicit-any": "error",
		"@typescript-eslint/prefer-readonly": "error",
		"@typescript-eslint/prefer-nullish-coalescing": "error",
		"@typescript-eslint/prefer-optional-chain": "error",
		"@typescript-eslint/no-unused-vars": "error",
		"react/prop-types": "off",
		"react/react-in-jsx-scope": "off"
	}
}
```

### Pre-commit Hooks

```json
{
	"husky": {
		"hooks": {
			"pre-commit": "lint-staged",
			"pre-push": "npm run type-check && npm run test"
		}
	},
	"lint-staged": {
		"*.{ts,tsx}": ["eslint --fix", "prettier --write", "git add"]
	}
}
```

This comprehensive TypeScript Style Guide ensures enterprise-grade code quality, maintainability, and developer productivity across React applications of any scale.
