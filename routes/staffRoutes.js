import express from "express";
import bcrypt from "bcryptjs";
import db from "../config/db.js";
import { verifyAdmin, requirePermission } from "../middleware/authMiddleware.js";

const router = express.Router();

// Master permissions catalog categorized by system module
export const SYSTEM_PERMISSIONS = [
  {
    category: "Dashboard",
    description: "Analytics and business overview",
    permissions: [
      { key: "dashboard.view", label: "View Dashboard & Metrics", description: "Can view sales, revenue, and store statistics" },
    ],
  },
  {
    category: "Products & Catalog",
    description: "Manage store catalog and inventory",
    permissions: [
      { key: "products.view", label: "View Products", description: "Can view product list and item details" },
      { key: "products.create", label: "Create Products", description: "Can add new products and variants" },
      { key: "products.edit", label: "Edit Products", description: "Can update prices, details, images, and stock" },
      { key: "products.delete", label: "Delete Products", description: "Can remove products from store" },
    ],
  },
  {
    category: "Orders & Fulfillment",
    description: "Manage customer purchases and shipments",
    permissions: [
      { key: "orders.view", label: "View Orders", description: "Can browse orders and order details" },
      { key: "orders.edit", label: "Update Order Status", description: "Can change status (Shipped, Delivered, Cancelled)" },
      { key: "orders.delete", label: "Delete Orders", description: "Can remove orders from database" },
    ],
  },
  {
    category: "Customers",
    description: "Customer management and lookup",
    permissions: [
      { key: "customers.view", label: "View Customers", description: "Can view customer profiles and contact info" },
    ],
  },
  {
    category: "Deals & Coupons",
    description: "Discounts, promotions, and weekly deals",
    permissions: [
      { key: "deals.view", label: "View Deals & Coupons", description: "Can see active discount codes and weekly promotions" },
      { key: "deals.manage", label: "Manage Deals & Coupons", description: "Can create, edit, and delete coupons and weekly deals" },
    ],
  },
  {
    category: "Authenticator",
    description: "Product authenticity codes and verification",
    permissions: [
      { key: "authenticator.view", label: "View Authenticity Codes", description: "Can view generated security codes" },
      { key: "authenticator.generate", label: "Generate Codes", description: "Can generate and export packaging verification codes" },
    ],
  },
  {
    category: "Staff Management (RBAC)",
    description: "Manage staff accounts, team members, and permissions",
    permissions: [
      { key: "staff.view", label: "View Staff List", description: "Can see team members and assigned roles" },
      { key: "staff.create", label: "Add Staff Member", description: "Can create new staff accounts" },
      { key: "staff.edit", label: "Edit Staff & Roles", description: "Can edit permissions, roles, and status" },
      { key: "staff.delete", label: "Delete Staff Member", description: "Can remove staff accounts" },
    ],
  },
  {
    category: "Store Settings",
    description: "Store policies, payments, and notifications",
    permissions: [
      { key: "settings.view", label: "View Settings", description: "Can view store settings" },
      { key: "settings.edit", label: "Edit Settings", description: "Can update payment, shipping, and store configuration" },
    ],
  },
];

// Predefined role presets - strictly Manager and Sales for staff creation
export const PRESET_ROLES = [
  {
    name: "Super Admin",
    description: "Full unrestricted access to every feature and administrative settings.",
    permissions: ["*"],
    selectableForStaff: false,
  },
  {
    name: "Manager",
    description: "Full store management: products, inventory, categories, orders, customers, deals.",
    permissions: [
      "dashboard.view",
      "products.view",
      "products.create",
      "products.edit",
      "products.delete",
      "orders.view",
      "orders.edit",
      "customers.view",
      "deals.view",
      "deals.manage",
      "authenticator.view",
      "authenticator.generate",
      "settings.view",
    ],
    selectableForStaff: true,
  },
  {
    name: "Sales",
    description: "Sales & customer operations: view and update orders, customer support, deals, and view products.",
    permissions: [
      "dashboard.view",
      "orders.view",
      "orders.edit",
      "customers.view",
      "products.view",
      "deals.view",
    ],
    selectableForStaff: true,
  },
];

// 1. GET /roles-meta — Returns role presets & master permissions catalog
router.get("/roles-meta", verifyAdmin, (req, res) => {
  res.json({
    roles: PRESET_ROLES,
    permissionsCatalog: SYSTEM_PERMISSIONS,
  });
});

// 2. GET / — List all staff members
router.get("/", verifyAdmin, requirePermission("staff.view"), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, name, email, phone, role, permissions, is_active, created_at, updated_at
      FROM admins
      ORDER BY id ASC
    `);

    const staffList = rows.map((staff) => {
      let perms = [];
      if (Array.isArray(staff.permissions)) {
        perms = staff.permissions;
      } else if (typeof staff.permissions === "string") {
        try {
          perms = JSON.parse(staff.permissions);
        } catch {
          perms = [];
        }
      }
      return {
        ...staff,
        permissions: perms,
      };
    });

    const totalStaff = staffList.length;
    const activeStaff = staffList.filter((s) => s.is_active !== false).length;
    const deactivatedStaff = totalStaff - activeStaff;
    const superAdmins = staffList.filter((s) => s.role === "Super Admin").length;

    res.json({
      staff: staffList,
      stats: {
        totalStaff,
        activeStaff,
        deactivatedStaff,
        superAdmins,
      },
    });
  } catch (err) {
    console.error("Fetch staff error:", err);
    res.status(500).json({ message: "Failed to fetch staff members.", error: err.message });
  }
});

// 3. POST / — Create a new staff member
router.post("/", verifyAdmin, requirePermission("staff.create"), async (req, res) => {
  const { name, email, password, phone, role, permissions, is_active = true } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required." });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters long." });
  }

  const assignedRole = role || "Manager";

  // Allowed staff creation roles are strictly Manager and Sales (Super Admin allowed only if created by Super Admin)
  const allowedRoles = ["Manager", "Sales", "Store Manager"];
  if (req.admin.role === "Super Admin") allowedRoles.push("Super Admin");
  if (!allowedRoles.includes(assignedRole)) {
    return res.status(400).json({ message: "Staff role must be either 'Manager' or 'Sales'." });
  }

  // Prevent non-Super-Admin from creating a Super Admin
  if (assignedRole === "Super Admin" && req.admin.role !== "Super Admin") {
    return res.status(403).json({ message: "Only an existing Super Admin can create another Super Admin." });
  }

  try {
    // Check if email is already in use
    const { rows: existing } = await db.query(
      "SELECT id FROM admins WHERE LOWER(email) = LOWER($1)",
      [email.trim()]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: "An admin/staff member with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const permsJson = JSON.stringify(Array.isArray(permissions) ? permissions : []);

    const { rows: newStaff } = await db.query(
      `INSERT INTO admins (name, email, password, phone, role, permissions, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, name, email, phone, role, permissions, is_active, created_at, updated_at`,
      [name.trim(), email.trim().toLowerCase(), hashedPassword, phone || null, assignedRole, permsJson, Boolean(is_active)]
    );

    let createdPerms = [];
    try {
      createdPerms = JSON.parse(newStaff[0].permissions);
    } catch {
      createdPerms = [];
    }

    res.status(201).json({
      message: "Staff member created successfully.",
      staff: {
        ...newStaff[0],
        permissions: createdPerms,
      },
    });
  } catch (err) {
    console.error("Create staff error:", err);
    res.status(500).json({ message: "Failed to create staff member.", error: err.message });
  }
});

// 4. PUT /:id — Update staff details, role, permissions, or password
router.put("/:id", verifyAdmin, requirePermission("staff.edit"), async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, role, permissions, is_active, password } = req.body;

  try {
    const { rows: existingRows } = await db.query("SELECT * FROM admins WHERE id = $1", [id]);

    if (existingRows.length === 0) {
      return res.status(404).json({ message: "Staff member not found." });
    }

    const existingStaff = existingRows[0];

    // Non-Super-Admins cannot modify a Super Admin
    if (existingStaff.role === "Super Admin" && req.admin.role !== "Super Admin") {
      return res.status(403).json({ message: "Only a Super Admin can edit Super Admin accounts." });
    }

    // Check email conflict if email changed
    if (email && email.trim().toLowerCase() !== existingStaff.email.toLowerCase()) {
      const { rows: emailCheck } = await db.query(
        "SELECT id FROM admins WHERE LOWER(email) = LOWER($1) AND id != $2",
        [email.trim(), id]
      );
      if (emailCheck.length > 0) {
        return res.status(400).json({ message: "Email is already taken by another staff member." });
      }
    }

    // Build update query dynamically
    let updatedPassword = existingStaff.password;
    if (password && password.trim()) {
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      updatedPassword = await bcrypt.hash(password, 10);
    }

    const updatedName = name !== undefined ? name.trim() : existingStaff.name;
    const updatedEmail = email !== undefined ? email.trim().toLowerCase() : existingStaff.email;
    const updatedPhone = phone !== undefined ? phone : existingStaff.phone;
    const updatedRole = role !== undefined ? role : existingStaff.role;
    const updatedStatus = is_active !== undefined ? Boolean(is_active) : existingStaff.is_active;

    let updatedPermsJson = existingStaff.permissions;
    if (permissions !== undefined) {
      updatedPermsJson = JSON.stringify(Array.isArray(permissions) ? permissions : []);
    }

    const { rows: updatedRows } = await db.query(
      `UPDATE admins
       SET name = $1, email = $2, phone = $3, role = $4, permissions = $5, is_active = $6, password = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING id, name, email, phone, role, permissions, is_active, created_at, updated_at`,
      [updatedName, updatedEmail, updatedPhone, updatedRole, updatedPermsJson, updatedStatus, updatedPassword, id]
    );

    let perms = [];
    try {
      perms = JSON.parse(updatedRows[0].permissions);
    } catch {
      perms = [];
    }

    res.json({
      message: "Staff member updated successfully.",
      staff: {
        ...updatedRows[0],
        permissions: perms,
      },
    });
  } catch (err) {
    console.error("Update staff error:", err);
    res.status(500).json({ message: "Failed to update staff member.", error: err.message });
  }
});

// 5. PUT /:id/status — Quick toggle active/inactive status
router.put("/:id/status", verifyAdmin, requirePermission("staff.edit"), async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  try {
    const { rows: existingRows } = await db.query("SELECT * FROM admins WHERE id = $1", [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ message: "Staff member not found." });
    }

    const targetStaff = existingRows[0];

    // Cannot deactivate the currently logged in user or the Super Admin if it's the last one
    if (Number(req.admin.id) === Number(id) && !is_active) {
      return res.status(400).json({ message: "You cannot deactivate your own account." });
    }

    if (targetStaff.role === "Super Admin" && !is_active) {
      const { rows: superAdmins } = await db.query(
        "SELECT id FROM admins WHERE role = 'Super Admin' AND is_active = true"
      );
      if (superAdmins.length <= 1) {
        return res.status(400).json({ message: "Cannot deactivate the only active Super Admin." });
      }
    }

    await db.query(
      "UPDATE admins SET is_active = $1, updated_at = NOW() WHERE id = $2",
      [Boolean(is_active), id]
    );

    res.json({
      message: `Staff member ${is_active ? "activated" : "deactivated"} successfully.`,
      is_active: Boolean(is_active),
    });
  } catch (err) {
    console.error("Status toggle error:", err);
    res.status(500).json({ message: "Failed to update staff status.", error: err.message });
  }
});

// 6. DELETE /:id — Delete staff member
router.delete("/:id", verifyAdmin, requirePermission("staff.delete"), async (req, res) => {
  const { id } = req.params;

  try {
    const { rows: existingRows } = await db.query("SELECT * FROM admins WHERE id = $1", [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ message: "Staff member not found." });
    }

    const targetStaff = existingRows[0];

    // Cannot delete yourself
    if (Number(req.admin.id) === Number(id)) {
      return res.status(400).json({ message: "You cannot delete your own account." });
    }

    // Cannot delete Super Admin
    if (targetStaff.role === "Super Admin") {
      return res.status(403).json({ message: "Super Admin accounts cannot be deleted for system safety." });
    }

    await db.query("DELETE FROM admins WHERE id = $1", [id]);

    res.json({ message: "Staff member deleted successfully." });
  } catch (err) {
    console.error("Delete staff error:", err);
    res.status(500).json({ message: "Failed to delete staff member.", error: err.message });
  }
});

export default router;
