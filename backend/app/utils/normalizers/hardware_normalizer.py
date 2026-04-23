from .base_normalizer import normalize_row


def normalize_hardware_record(row):
    r = normalize_row(row if isinstance(row, dict) else {})

    def first(*keys):
        for key in keys:
            value = r.get(key)
            if value is not None and str(value).strip():
                return value
        return None

    return {
        "device_name": first("u_hardware_1", "name", "device_name", "computer_name") or "",
        "asset_tag": first("asset_tag", "u_hardware_1_asset_tag"),
        "assigned_to": first("assigned_to", "owner", "device_owner", "u_hardware_1_assigned_to"),
        "serial_number": first("serial_number", "u_hardware_1_serial_number"),
        "department": first("department", "u_hardware_1_department"),
        "status": first("install_status", "status", "u_hardware_1_install_status"),
        "ip_address": first("ip_address", "ip", "u_hardware_1_ip_address"),
        "mac_address": first("mac_address", "u_hardware_1_mac_address"),
        "manufacturer": first("manufacturer", "u_hardware_1_manufacturer"),
        "model": first("model", "short_description", "u_hardware_1_short_description"),
        "location": first("location", "site", "u_hardware_1_location"),
        "floor": first("u_location_floor", "floor", "u_hardware_1_u_location_floor"),
        "last_seen": first("last_discovered", "u_hardware_1_last_discovered"),
    }
