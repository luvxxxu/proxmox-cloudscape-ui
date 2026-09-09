import type { NextRequest } from 'next/server';
import { createConsole } from '@/app/lib/console-server';
export const POST = (request: NextRequest) => createConsole(request, true);
