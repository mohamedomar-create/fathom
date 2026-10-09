"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

export const createClient = () => createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
