---
name: "fusion-aigc-web-toolkit"
description: "Provides utilities and best practices for Fusion AIGC Web project - a Vue 3 + TypeScript e-commerce image generation platform. Invoke when working on this project for API handling, component development, and build configuration."
---

# Fusion AIGC Web Toolkit

## Overview

This toolkit provides utilities and best practices for the **Fusion AIGC Web** project, a Vue 3 + TypeScript e-commerce image generation platform.

## Key Features

### 1. API Handling
- Token-based authentication with automatic refresh
- Request/response interceptors
- Error handling with Naive UI message component

### 2. Component Library
- `ChatImageUpload` - Chat-style image upload component
- `WaterfallVirtualScroller` - Virtual scroll waterfall layout
- `Tab` - Tab navigation component
- `Textarea` - Enhanced textarea component

### 3. Directives
- `v-observer-scroll-to-bottom` - Scroll position observer
- `v-loading` - Loading state directive

### 4. State Management
- Pinia store integration
- Local storage persistence for auth tokens

## Project Structure

```
src/
├── api/           # API layer with interceptors
├── assets/        # Static resources
├── components/    # Reusable components
├── directives/    # Custom Vue directives
├── router/        # Vue Router configuration
├── stores/        # Pinia stores
├── utils/         # Utility functions/composables
└── views/         # Page views
```

## Usage Examples

### Making API Requests

```typescript
import { post, get } from '@/api'

// POST request
const result = await post('/api/v1/storage/direct/sts', {
  subDir: 'uploads',
  visibility: 'public'
})

// GET request
const data = await get('/api/v1/users', { id: 1 })
```

### Using Composables

```typescript
import { useDebounce } from '@/utils/composables'
import { reactive } from 'vue'

const filters = reactive({ value1: 0, value2: 0 })

useDebounce(filters, () => {
  console.log('Filters changed')
}, 300)
```

### Virtual Scroll Waterfall

```vue
<WaterfallVirtualScroller :waterfallData="data" />
```

## Build Commands

```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run lint       # ESLint check
npm run format     # Prettier formatting
npm run type-check # TypeScript check
```

## Authentication Flow

1. Login via `/api/v1/auth/login`
2. Access token stored in localStorage
3. Auto-refresh on 401 with refresh token
4. Request queue management during refresh

## Best Practices

1. Use TypeScript for type safety
2. Leverage Vue 3 Composition API
3. Follow Pinia store patterns
4. Use Naive UI for consistent styling
5. Implement proper error handling
6. Use composables for reusable logic
