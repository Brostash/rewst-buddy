# TypeScript Style Guide

## A structured approach to writing TypeScript code

This guide is based on best practices for writing clean, maintainable, and scalable TypeScript code. It includes specific rules and conventions to follow when writing TypeScript in React projects.

## Introduction

### What

Consistency is key to maintaining a high-quality, scalable, and maintainable codebase. This TypeScript Style Guide enforces best practices using automated tools like ESLint, TypeScript, and Prettier, while also providing design and architectural conventions that developers should follow.

### Why

As projects grow, maintaining a uniform coding style and ensuring best practices become increasingly important. A well-defined style guide provides:

- A consistent codebase, reducing technical debt.
- Faster development cycles with fewer disputes over code style.
- Easier onboarding for new developers by minimizing learning curves.
- Improved readability and maintainability across the team.

### TL;DR - Quick Best Practices

✅ Prefer const for immutability and readonly properties

✅ Use union types over enums when possible

✅ Avoid any and prefer unknown or proper type definitions

✅ Use PascalCase for components and camelCase for variables/functions

✅ Keep functions pure, stateless, and single-responsibility

✅ Follow consistent naming conventions across the codebase

✅ Prefer explicit return types for functions

By following these conventions, your TypeScript projects will be more predictable, efficient, and scalable. 🚀

---

## 1. Basic Rules

- Use **TypeScript** syntax and avoid `any` unless absolutely necessary.
- Always define types for function parameters and return values.
- Enable **strict mode** in `tsconfig.json`.
- Use `const` and `let` instead of `var`.
- Prefer `readonly` for immutable object properties.
- Do not use `namespace`; use ES6 modules instead.
- Avoid non-null assertions (`!`), except when absolutely necessary.

---

## 2. Type Annotations

- Always specify types explicitly when the type is not inferred.
- Avoid redundant type annotations where TypeScript can infer them.

```ts
// Bad
let age: number = 25;

// Good
let age = 25; // TypeScript infers `number`
```

- Use `unknown` instead of `any` where applicable.
- Use `never` for functions that never return.

```ts
// Bad
function throwError(message: string): void {
  throw new Error(message);
}

// Good
function throwError(message: string): never {
  throw new Error(message);
}
```

---

## 3. Interfaces vs. Types

- Use `interface` for defining object shapes.
- Use `type` for unions, intersections, or primitive-based types.

```ts
// Bad
type User = {
  id: number;
  name: string;
};

// Good
interface User {
  id: number;
  name: string;
}
```

- Use `extends` for interface inheritance.

```ts
// Bad: Using type for extending an object type
type AdminProps = UserProps & {
  role: "admin" | "super-admin";
};

// Good: Using interface with extends
interface AdminProps extends UserProps {
  role: "admin" | "super-admin";
}

const AdminCard: React.FC<AdminProps> = ({ id, name, role }) => {
  return (
    <div>
      <h3>Admin ID: {id}</h3>
      <p>Name: {name}</p>
      <p>Role: {role}</p>
    </div>
  );
};

export default AdminCard;
```

## 5. Mixins

- **Do not use mixins**.
- Prefer Higher-Order Components (HOCs) or custom hooks.

```ts
// Bad
const WithLogging = (Base: any) =>
  class extends Base {
    log() {
      console.log("Logging...");
    }
  };

// Good
function useLogging() {
  useEffect(() => {
    console.log("Logging...");
  }, []);
}
```

---

## 6. Naming Conventions

- Use **PascalCase** for components.

```ts
// ❌ Bad: Using lowercase or camelCase for a component name
function userprofile() {
  return <div>User Profile</div>;
}

export default userprofile;

// ✅ Good: Using PascalCase for the component name
function UserProfile() {
  return <div>User Profile</div>;
}

export default UserProfile;
```

- Use **camelCase** for variables and functions.

```ts
// ❌ Bad: Using uppercase or PascalCase for variables
const UserName = "Alice";
function GetUserAge() {
  return 30;
}

// ✅ Good: Use camelCase for variables and functions
const userName = "Alice";
function getUserAge() {
  return 30;
}
```

- Use `T` prefix for generic type parameters.

```ts
// ❌ Bad: Generic type has no `T` prefix
function getFirstItem<Type>(arr: Type[]): Type {
  return arr[0];
}

// ✅ Good: Generic type prefixed with `T`
function getFirstItem<T>(arr: T[]): T {
  return arr[0];
}
```

- Use meaningful names.

```ts
// ❌ Bad: Unclear variable names
const x = "John";
const d = new Date();
function doSomething() {
  return "Hello";
}

// ✅ Good: Meaningful variable and function names
const userName = "John";
const currentDate = new Date();
function generateGreeting() {
  return "Hello";
}
```

- Naming Conventions in Props & State

```ts
// ❌ Bad: Non-standard prop names
interface UserProps {
  User_Name: string;
  AGE: number;
}

// ✅ Good: camelCase for props
interface UserProps {
  userName: string;
  age: number;
}
```

---

## 7. Declarations & Alignment

- Use **single responsibility** per file.

```ts
// Bad: Multiple components in a single file
const Header = () => <header>Header</header>;
const Footer = () => <footer>Footer</footer>;

export { Header, Footer };

// Good: Separate files for each component
// Header.tsx
const Header = () => <header>Header</header>;
export default Header;

// Footer.tsx
const Footer = () => <footer>Footer</footer>;
export default Footer;
```

- Use `export default` for components.

```ts
// Bad: Named export for a single component
export const Button = () => <button>Click me</button>;

// Good: Default export for a single component
const Button = () => <button>Click me</button>;
export default Button;
```

- Maintain **consistent indentation** and spacing.

---

## 8. Quotes & Spacing

- Use **single quotes** for JavaScript/TypeScript.

```ts
// Bad
const message = "Hello World";

// Good
const message = "Hello World";
```

- Use **double quotes** for JSX attributes.

```ts
// Bad
<Button label="Click me" />;

// Good
<Button label="Click me" />;
```

- Do not pad JSX curly braces.

````ts
// Bad
<Component prop={ someValue } />;

---

## 13. Enums

Enums allow defining a set of named constants. Use them when a variable can take one of a few predefined values.

### Numeric Enums

```ts
enum Status {
  Pending,
  InProgress,
  Completed
}
````

### String Enums

```ts
enum Status {
  Pending = "Pending",
  InProgress = "InProgress",
  Completed = "Completed",
}
```
