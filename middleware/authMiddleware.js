import jwt from "jsonwebtoken";
import db from "../config/db.js";

export async function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided. Please log in." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh status and permissions from database to ensure real-time security
    const { rows } = await db.query(
      "SELECT id, name, email, role, permissions, is_active FROM admins WHERE id = $1",
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Admin account no longer exists." });
    }

    const admin = rows[0];

    if (admin.is_active === false) {
      return res.status(403).json({
        message: "Your staff account has been deactivated. Please contact the Super Admin.",
      });
    }

    let parsedPermissions = [];
    if (Array.isArray(admin.permissions)) {
      parsedPermissions = admin.permissions;
    } else if (typeof admin.permissions === "string") {
      try {
        parsedPermissions = JSON.parse(admin.permissions);
      } catch {
        parsedPermissions = [];
      }
    }

    req.admin = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      permissions: parsedPermissions,
      is_active: admin.is_active,
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token. Please log in again." });
  }
}

/**
 * Middleware factory for Granular Role-Based Permission checks
 * @param {string|string[]} requiredPerms Single permission or array of allowed permissions
 */
export function requirePermission(requiredPerms) {
  const permsToCheck = Array.isArray(requiredPerms) ? requiredPerms : [requiredPerms];

  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ message: "Unauthorized. Authentication required." });
    }

    const { role, permissions = [] } = req.admin;

    // Super Admin has full unrestricted access
    if (role === "Super Admin" || permissions.includes("*")) {
      return next();
    }

    // Check if user has at least one of the required permissions
    const hasAllowedPermission = permsToCheck.some((perm) => permissions.includes(perm));

    if (!hasAllowedPermission) {
      return res.status(403).json({
        message: `Access denied. You lack required permission: ${permsToCheck.join(" or ")}`,
        requiredPermissions: permsToCheck,
      });
    }

    next();
  };
}