using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Data;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        await db.Database.EnsureCreatedAsync();
        await EnsureMaterialSpecDensityColumnAsync(db);

        if (await db.Projects.AnyAsync()) return;

        var project1 = new Project
        {
            Name = "A320 SKY",
            DateRegistered = new DateOnly(2026, 1, 15),
            Owner = "Hakim",
            Status = "Open"
        };
        var project2 = new Project
        {
            Name = "B737 NG",
            DateRegistered = new DateOnly(2026, 2, 3),
            Owner = "Alex",
            Status = "Closed"
        };
        db.Projects.AddRange(project1, project2);
        await db.SaveChangesAsync();

        db.Parts.AddRange(
            new Part
            {
                ProjectId = project1.Id,
                Aircraft = "A320",
                No = 1,
                PartNumber = "141T1380-31",
                PartDescription = "BRACKET ASSY",
                Qpa = 1,
                FirstLaunchQty = 12,
                FirstDelivery = "2026-Q3",
                MaterialSpec = "AMS 4050",
                FinishThickness = 12.7,
                FinishWidth = 50.8,
                FinishLength = 203.2,
                MaterialRulingDim = 50.8,
                MaterialThickness = 50.8,
                MaterialWidth = 266.7,
                MaterialLength = 2032,
                QtyPerBillet = 1,
                SetupTimeHour = 2,
                CycleTurnMill = 0,
                Cycle3x = 3.58,
                Cycle4x = 91.42,
                Cycle5x = 0,
                CycleTotalHrs = 5.79
            },
            new Part
            {
                ProjectId = project1.Id,
                Aircraft = "A320",
                No = 2,
                PartNumber = "141T1380-32",
                PartDescription = "BRACKET",
                Qpa = 2,
                FirstLaunchQty = 24,
                FirstDelivery = "2026-Q4",
                MaterialSpec = "AMS 4050",
                FinishThickness = 10,
                FinishWidth = 40,
                FinishLength = 150,
                MaterialRulingDim = 40,
                MaterialThickness = 40,
                MaterialWidth = 200,
                MaterialLength = 1500,
                QtyPerBillet = 2,
                SetupTimeHour = 1.5,
                CycleTurnMill = 0,
                Cycle3x = 2,
                Cycle4x = 4,
                Cycle5x = 0,
                CycleTotalHrs = 1.2
            });

        db.Users.AddRange(
            new User
            {
                Username = "hakim",
                DisplayName = "Hakim Hisham",
                CreatedDate = new DateOnly(2025, 11, 1),
                Status = "Active"
            },
            new User
            {
                Username = "alex",
                DisplayName = "Alex Tan",
                CreatedDate = new DateOnly(2026, 1, 15),
                Status = "Active"
            },
            new User
            {
                Username = "viewer",
                DisplayName = "Read Only",
                CreatedDate = new DateOnly(2026, 3, 20),
                Status = "Inactive"
            });

        db.MaterialSpecs.AddRange(
            new MaterialSpec
            {
                Specification = "AMS 4050",
                GeneralName = "Al 7050 Plate",
                MaterialType = "Aluminum",
                CreatedBy = "Hakim Hisham",
                CreatedDate = new DateOnly(2026, 1, 10),
                Status = "Active"
            },
            new MaterialSpec
            {
                Specification = "AMS 5659",
                GeneralName = "Inconel 718 Bar",
                MaterialType = "Superalloy",
                CreatedBy = "Alex Tan",
                CreatedDate = new DateOnly(2026, 2, 1),
                Status = "Active"
            },
            new MaterialSpec
            {
                Specification = "AMS 4928",
                GeneralName = "Ti-6Al-4V",
                MaterialType = "Titanium",
                CreatedBy = "Hakim Hisham",
                CreatedDate = new DateOnly(2026, 2, 18),
                Status = "Inactive"
            });

        await db.SaveChangesAsync();
    }

    private static async Task EnsureMaterialSpecDensityColumnAsync(AppDbContext db)
    {
        try
        {
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE MaterialSpecs ADD COLUMN Density REAL NOT NULL DEFAULT 0;");
        }
        catch (Exception ex) when (IsSqliteDuplicateColumn(ex))
        {
            // Column already exists on upgraded databases.
        }

        await db.Database.ExecuteSqlRawAsync(
            """
            UPDATE MaterialSpecs SET Density = 2830 WHERE Specification = 'AMS 4050' AND (Density IS NULL OR Density = 0);
            UPDATE MaterialSpecs SET Density = 8190 WHERE Specification = 'AMS 5659' AND (Density IS NULL OR Density = 0);
            UPDATE MaterialSpecs SET Density = 4430 WHERE Specification = 'AMS 4928' AND (Density IS NULL OR Density = 0);
            """);
    }

    private static bool IsSqliteDuplicateColumn(Exception ex)
    {
        var msg = ex.Message;
        return msg.Contains("duplicate column", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("already exists", StringComparison.OrdinalIgnoreCase);
    }
}
