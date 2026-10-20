/** One place for how order statuses look, so customer, store-owner and admin screens agree. */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  PLACED: "Placed",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const ORDER_STATUS_BADGE: Record<string, string> = {
  PLACED: "badge badge-warning",
  CONFIRMED: "badge badge-success",
  PACKED: "badge badge-success",
  SHIPPED: "badge badge-success",
  DELIVERED: "badge badge-success",
  CANCELLED: "badge badge-danger",
};

export const orderStatusLabel = (status: string) => ORDER_STATUS_LABEL[status] || status;
export const orderStatusBadge = (status: string) => ORDER_STATUS_BADGE[status] || "badge";
