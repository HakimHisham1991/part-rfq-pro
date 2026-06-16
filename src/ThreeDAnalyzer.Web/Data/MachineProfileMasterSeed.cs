using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Data;

public static class MachineProfileMasterSeed
{
    private const string SeedFileName = "machines-master.json";
    private const string SeedCreatedBy = "Admin";
    private const string MarkerName = "Hartford Aero-426";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static async Task EnsureSeededAsync(AppDbContext db)
    {
        await EnsureTableAsync(db);
        await EnsureAxisTypesColumnAsync(db);

        var items = LoadMasterItems();
        if (items.Count == 0) return;

        if (!await db.MachineProfiles.AnyAsync(m => m.Name == MarkerName))
        {
            var existing = await db.MachineProfiles.ToListAsync();
            if (existing.Count > 0)
                db.MachineProfiles.RemoveRange(existing);

            foreach (var item in items)
                db.MachineProfiles.Add(CreateProfile(item));

            await db.SaveChangesAsync();
            return;
        }

        await SyncMasterProfilesAsync(db, items);
    }

    private static async Task SyncMasterProfilesAsync(AppDbContext db, List<MachineProfileMasterItem> items)
    {
        var changed = false;
        foreach (var item in items)
        {
            var existing = await db.MachineProfiles.FirstOrDefaultAsync(m => m.Name == item.Name);
            if (existing == null)
            {
                db.MachineProfiles.Add(CreateProfile(item));
                changed = true;
                continue;
            }

            var axisTypes = NormalizeAxisTypes(item.AxisTypes);
            if (existing.AxisTypes != axisTypes)
            {
                existing.AxisTypes = axisTypes;
                changed = true;
            }
        }

        if (changed)
            await db.SaveChangesAsync();
    }

    private static MachineProfile CreateProfile(MachineProfileMasterItem item)
    {
        return new MachineProfile
        {
            Name = item.Name,
            AxisTypes = NormalizeAxisTypes(item.AxisTypes),
            RapidRateMmpm = item.RapidRateMmpm,
            SpindlePowerKw = item.SpindlePowerKw,
            AccelDecelFactor = item.AccelDecelFactor,
            ToolChangeTimeSec = item.ToolChangeTimeSec,
            CreatedBy = SeedCreatedBy,
            CreatedDate = new DateOnly(2026, 6, 11),
            Status = item.Status ?? "Active"
        };
    }

    private static string NormalizeAxisTypes(string? axisTypes)
    {
        var value = (axisTypes ?? "").Trim().ToUpperInvariant();
        return value is "2X" or "3X" or "4X" or "5X" ? value : "";
    }

    private static async Task EnsureTableAsync(AppDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS MachineProfiles (
                Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                Name TEXT NOT NULL,
                RapidRateMmpm REAL NOT NULL DEFAULT 0,
                SpindlePowerKw REAL NOT NULL DEFAULT 0,
                AccelDecelFactor REAL NOT NULL DEFAULT 1,
                ToolChangeTimeSec REAL NOT NULL DEFAULT 0,
                CreatedBy TEXT NOT NULL DEFAULT '',
                CreatedDate TEXT NOT NULL,
                Status TEXT NOT NULL DEFAULT 'Active'
            );
            """);

        await db.Database.ExecuteSqlRawAsync("""
            CREATE UNIQUE INDEX IF NOT EXISTS IX_MachineProfiles_Name
            ON MachineProfiles (Name);
            """);
    }

    private static async Task EnsureAxisTypesColumnAsync(AppDbContext db)
    {
        if (!await SqliteColumnExistsAsync(db, "MachineProfiles", "AxisTypes"))
        {
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE MachineProfiles ADD COLUMN AxisTypes TEXT NOT NULL DEFAULT '';");
        }
    }

    private static async Task<bool> SqliteColumnExistsAsync(
        AppDbContext db,
        string tableName,
        string columnName)
    {
        await db.Database.OpenConnectionAsync();
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText =
                $"SELECT 1 FROM pragma_table_info('{tableName}') WHERE name = $name LIMIT 1";
            var param = command.CreateParameter();
            param.ParameterName = "$name";
            param.Value = columnName;
            command.Parameters.Add(param);
            return await command.ExecuteScalarAsync() != null;
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    private static List<MachineProfileMasterItem> LoadMasterItems()
    {
        var path = ResolveSeedPath();
        if (!File.Exists(path)) return [];

        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<List<MachineProfileMasterItem>>(json, JsonOptions) ?? [];
    }

    private static string ResolveSeedPath()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "Data", SeedFileName),
            Path.Combine(Directory.GetCurrentDirectory(), "Data", SeedFileName),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Data", SeedFileName)
        };

        foreach (var c in candidates)
        {
            var full = Path.GetFullPath(c);
            if (File.Exists(full)) return full;
        }

        return Path.GetFullPath(candidates[0]);
    }

    private sealed class MachineProfileMasterItem
    {
        public string Name { get; set; } = "";
        public string? AxisTypes { get; set; }
        public double RapidRateMmpm { get; set; }
        public double SpindlePowerKw { get; set; }
        public double AccelDecelFactor { get; set; }
        public double ToolChangeTimeSec { get; set; }
        public string? Status { get; set; }
    }
}
