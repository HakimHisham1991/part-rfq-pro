using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Data;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        await db.Database.EnsureCreatedAsync();
        await EnsureMaterialSpecDensityColumnAsync(db);
        await EnsureUserPasswordColumnAsync(db);
        await SeedUsersAsync(db);
        await MaterialSpecMasterSeed.EnsureSeededAsync(db);

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

        await db.SaveChangesAsync();
    }

    private static async Task EnsureMaterialSpecDensityColumnAsync(AppDbContext db)
    {
        if (!await SqliteColumnExistsAsync(db, "MaterialSpecs", "Density"))
        {
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE MaterialSpecs ADD COLUMN Density REAL NOT NULL DEFAULT 0;");
        }

    }

    private static async Task EnsureUserPasswordColumnAsync(AppDbContext db)
    {
        if (!await SqliteColumnExistsAsync(db, "Users", "Password"))
        {
            await db.Database.ExecuteSqlRawAsync(
                "ALTER TABLE Users ADD COLUMN Password TEXT NOT NULL DEFAULT '';");
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

    private static async Task SeedUsersAsync(AppDbContext db)
    {
        var seedUsers = new[]
        {
            ("adib.jamil", "abc123", "Adib Jamil", "ACTIVE"),
            ("bakhari.hussin", "abc123", "Bakhari Hussin", "ACTIVE"),
            ("boon.bao", "abc123", "Low Boon Bao", "ACTIVE"),
            ("chee.wei", "abc123", "Tan Chee Wei", "ACTIVE"),
            ("faiq.faizul", "abc123", "Faiq Faizul", "ACTIVE"),
            ("hakim.hisham", "abc123", "Hakim Hisham", "ACTIVE"),
            ("hakim.ramaly", "abc123", "Hakim Ramaly", "ACTIVE"),
            ("ismail.jahrin", "abc123", "Ismail Jahrin", "ACTIVE"),
            ("nik.faiszal", "abc123", "Nik Faiszal Abdullah", "ACTIVE"),
            ("bazlan.suhaimi", "abc123", "Bazlan Suhaimi", "INACTIVE")
        };

        foreach (var (username, password, displayName, status) in seedUsers)
        {
            var existing = await db.Users.FirstOrDefaultAsync(u =>
                u.Username.ToLower() == username.ToLower());
            if (existing == null)
            {
                db.Users.Add(new User
                {
                    Username = username,
                    Password = password,
                    DisplayName = displayName,
                    CreatedDate = DateOnly.FromDateTime(DateTime.UtcNow),
                    Status = status
                });
            }
            else
            {
                existing.Password = password;
                existing.DisplayName = displayName;
                existing.Status = status;
            }
        }

        var seedUsernames = seedUsers.Select(u => u.Item1.ToLowerInvariant()).ToHashSet();
        var obsolete = await db.Users
            .Where(u => !seedUsernames.Contains(u.Username.ToLower()))
            .ToListAsync();
        if (obsolete.Count > 0)
        {
            db.Users.RemoveRange(obsolete);
            await db.SaveChangesAsync();
        }
    }
}
