export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_ingestions: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          cost_usd: number | null
          created_at: string
          error_message: string | null
          extracted_data: Json
          final_data: Json | null
          id: string
          input_image_path: string | null
          input_text: string | null
          intent: string
          mode: string
          raw_response: Json
          status: string
          tenant_id: string
          tokens_input: number | null
          tokens_output: number | null
          user_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          extracted_data?: Json
          final_data?: Json | null
          id?: string
          input_image_path?: string | null
          input_text?: string | null
          intent: string
          mode: string
          raw_response?: Json
          status?: string
          tenant_id: string
          tokens_input?: number | null
          tokens_output?: number | null
          user_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          extracted_data?: Json
          final_data?: Json | null
          id?: string
          input_image_path?: string | null
          input_text?: string | null
          intent?: string
          mode?: string
          raw_response?: Json
          status?: string
          tenant_id?: string
          tokens_input?: number | null
          tokens_output?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_ingestions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          tenant_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string
          id: string
          movement_type: string
          notes: string | null
          product_id: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          signed_quantity: number | null
          stock_after: number
          stock_before: number
          tenant_id: string
          unit_cost: number | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          movement_type: string
          notes?: string | null
          product_id: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          signed_quantity?: number | null
          stock_after: number
          stock_before: number
          tenant_id: string
          unit_cost?: number | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          movement_type?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          signed_quantity?: number | null
          stock_after?: number
          stock_before?: number
          tenant_id?: string
          unit_cost?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_schemas: {
        Row: {
          attributes: Json
          created_at: string
          deleted_at: string | null
          id: string
          is_default: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attributes?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attributes?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_schemas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          attributes: Json
          cost_avg: number
          created_at: string
          current_stock: number
          deleted_at: string | null
          id: string
          is_active: boolean
          location: string | null
          min_stock: number
          name: string
          price: number
          reorder_point: number
          reorder_qty: number
          schema_id: string
          sku: string
          tenant_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          attributes?: Json
          cost_avg?: number
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          min_stock?: number
          name: string
          price?: number
          reorder_point?: number
          reorder_qty?: number
          schema_id: string
          sku: string
          tenant_id: string
          unit?: string
          updated_at?: string
        }
        Update: {
          attributes?: Json
          cost_avg?: number
          created_at?: string
          current_stock?: number
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          min_stock?: number
          name?: string
          price?: number
          reorder_point?: number
          reorder_qty?: number
          schema_id?: string
          sku?: string
          tenant_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_schema_id_fkey"
            columns: ["schema_id"]
            isOneToOne: false
            referencedRelation: "product_schemas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          created_at: string
          id: string
          line_profit: number
          line_subtotal: number
          product_id: string
          product_name_at_sale: string
          product_sku_at_sale: string
          quantity: number
          sale_id: string
          unit_cost_at_sale: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_profit: number
          line_subtotal: number
          product_id: string
          product_name_at_sale: string
          product_sku_at_sale: string
          quantity: number
          sale_id: string
          unit_cost_at_sale: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          line_profit?: number
          line_subtotal?: number
          product_id?: string
          product_name_at_sale?: string
          product_sku_at_sale?: string
          quantity?: number
          sale_id?: string
          unit_cost_at_sale?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          created_at: string
          created_by: string
          customer_email: string | null
          customer_name: string | null
          id: string
          notes: string | null
          payment_method: string
          pdf_path: string | null
          profit: number
          sale_number: number
          status: string
          subtotal: number
          tax_amount: number
          tenant_id: string
          total: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          notes?: string | null
          payment_method: string
          pdf_path?: string | null
          profit: number
          sale_number: number
          status?: string
          subtotal: number
          tax_amount?: number
          tenant_id: string
          total: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          notes?: string | null
          payment_method?: string
          pdf_path?: string | null
          profit?: number
          sale_number?: number
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id?: string
          total?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      search_log: {
        Row: {
          created_at: string
          id: string
          product_clicked: string | null
          query: string
          result_count: number
          source: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_clicked?: string | null
          query: string
          result_count?: number
          source: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_clicked?: string | null
          query?: string
          result_count?: number
          source?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_log_product_clicked_fkey"
            columns: ["product_clicked"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ai_cycle_start: string
          ai_ops_limit: number
          ai_ops_used: number
          business_type: string | null
          created_at: string
          id: string
          name: string
          settings: Json
          slug: string
          subscription_plan: string | null
          subscription_status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          ai_cycle_start?: string
          ai_ops_limit?: number
          ai_ops_used?: number
          business_type?: string | null
          created_at?: string
          id?: string
          name: string
          settings?: Json
          slug: string
          subscription_plan?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          ai_cycle_start?: string
          ai_ops_limit?: number
          ai_ops_used?: number
          business_type?: string | null
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          slug?: string
          subscription_plan?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_tenants: {
        Row: {
          created_at: string
          invited_by: string | null
          is_active: boolean
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          is_active?: boolean
          role: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string | null
          is_active?: boolean
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tenants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cash_reconciliation: {
        Args: {
          p_from: string
          p_tenant_id: string
          p_to: string
          p_user_id?: string
        }
        Returns: Json
      }
      current_user_role_in_tenant: {
        Args: { tenant_uuid: string }
        Returns: string
      }
      dashboard_kpis: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: Json
      }
      increment_ai_usage: {
        Args: { p_amount?: number; p_tenant_id: string }
        Returns: boolean
      }
      is_member_of_tenant: { Args: { tenant_uuid: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      record_inventory_movement: {
        Args: {
          p_movement_type: string
          p_notes?: string
          p_product_id: string
          p_quantity: number
          p_reference_id?: string
          p_reference_type?: string
          p_tenant_id: string
          p_unit_cost?: number
          p_unit_price?: number
        }
        Returns: string
      }
      register_sale: {
        Args: {
          p_customer_email: string
          p_customer_name: string
          p_items: Json
          p_notes: string
          p_payment_method: string
          p_tenant_id: string
        }
        Returns: string
      }
      reorder_alerts: {
        Args: { p_days_horizon?: number; p_tenant_id: string }
        Returns: {
          current_stock: number
          daily_velocity: number
          days_remaining: number
          min_stock: number
          name: string
          product_id: string
          reorder_point: number
          severity: string
          sku: string
        }[]
      }
      sales_by_day: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: {
          day: string
          profit: number
          sale_count: number
          total: number
        }[]
      }
      sales_by_payment_method: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: {
          payment_method: string
          sale_count: number
          total: number
        }[]
      }
      top_products: {
        Args: {
          p_from: string
          p_metric?: string
          p_tenant_id: string
          p_to: string
        }
        Returns: {
          name: string
          product_id: string
          sku: string
          total_profit: number
          total_qty: number
          total_revenue: number
        }[]
      }
      void_sale: {
        Args: { p_reason: string; p_sale_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
